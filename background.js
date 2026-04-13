import {
  findAvailableAccountByAddress,
  listAvailableAccounts,
  listSkippedAccounts,
  markAccountStatus,
  resolveCurrentAccountSelection,
  summarizeAccountAvailability,
} from './shared/account-ledger.js';
import { continueSingleAutoFlow, runAutoFlowBatch, runSingleAutoFlow } from './shared/auto-flow.js';
import { createAutoRunPausedError } from './shared/auto-run-control.js';
import { buildAutoRestartRuntimeUpdates } from './shared/auto-restart.js';
import { createInternalSessionClient } from './shared/internal-session-client.js';
import { createLuckmailClient } from './shared/luckmail-client.js';
import { resolveLoginPassword } from './shared/login-password.js';
import { createContentStepSignalRegistry, settleStepWaiterFromDispatchResult } from './shared/content-step-signals.js';
import { chooseOauthTabCandidate, listAuthTabIds } from './shared/open-oauth-target.js';
import { findLoopbackCallbackUrl } from './shared/oauth-step-helpers-core.js';
import { decideOauthTabNavigation } from './shared/oauth-tab-navigation.js';
import { buildPanelTabOpenPlan } from './shared/panel-tab-plan.js';
import { decideStep8ClickPlan } from './shared/step8-click-plan.js';
import { pollVerificationCode } from './shared/verification-poller.js';
import { createReadyCommandQueue } from './shared/ready-command-queue.js';
import { isMissingReceiverError } from './shared/runtime-message-errors.js';
import { executeSignupStepCommand } from './shared/signup-step-executor.js';
import { DEFAULT_RUNTIME, DEFAULT_SETTINGS, mergeLogs, sanitizeSettings } from './shared/state-machine.js';
import { pollVerificationCodeWithResend } from './shared/verification-recovery.js';

const readyCommandQueue = createReadyCommandQueue();
const contentStepSignals = createContentStepSignalRegistry();

async function configureSidePanelAction() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn('配置扩展图标打开侧边栏失败:', error);
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function getRuntime() {
  const stored = await chrome.storage.session.get(Object.keys(DEFAULT_RUNTIME));
  return { ...DEFAULT_RUNTIME, ...stored };
}

async function getState() {
  const [settings, runtime] = await Promise.all([getSettings(), getRuntime()]);
  return { ...settings, ...runtime };
}

async function setSettings(updates) {
  await chrome.storage.local.set(sanitizeSettings({ ...(await getSettings()), ...updates }));
}

async function setRuntime(updates) {
  await chrome.storage.session.set(updates);
}

async function resetTransientRuntime() {
  await setRuntime({
    selectedAccountAddress: '',
    currentAccount: null,
    currentEmailRecord: null,
    authTabId: null,
    localhostUrl: '',
    lastSignupCode: '',
    lastLoginCode: '',
  });
}

async function addLog(message, level = 'info') {
  const runtime = await getRuntime();
  const logs = mergeLogs(runtime.logs, {
    level,
    message,
    timestamp: new Date().toISOString(),
  });
  await setRuntime({ logs });
}

async function setStepStatus(step, status) {
  const runtime = await getRuntime();
  await setRuntime({
    stepStatuses: {
      ...runtime.stepStatuses,
      [step]: status,
    },
  });
}

async function resetStepStatuses() {
  await setRuntime({
    stepStatuses: {
      1: 'pending',
      2: 'pending',
      3: 'pending',
      4: 'pending',
      5: 'pending',
      6: 'pending',
      7: 'pending',
      8: 'pending',
      9: 'pending',
    },
  });
}

const STEP_TITLES = Object.freeze({
  1: '获取 OAuth 链接',
  2: '进入注册流程',
  3: '填写邮箱和密码',
  4: '获取注册验证码',
  5: '填写基础资料',
  6: '刷新 OAuth 并登录',
  7: '获取登录验证码',
  8: '确认 OAuth 授权',
  9: '回填 CPA 校验',
});

function getStepLabel(step) {
  const title = STEP_TITLES[step];
  return title ? `步骤 ${step}：${title}` : `步骤 ${step}`;
}

function markErrorLogged(error) {
  if (error && typeof error === 'object') {
    error.__hotmailRegisterLogged = true;
  }
  return error;
}

function hasLoggedError(error) {
  return Boolean(error && typeof error === 'object' && error.__hotmailRegisterLogged);
}

function findProblemStep(stepStatuses = {}) {
  for (const status of ['failed', 'running']) {
    for (let step = 1; step <= 9; step += 1) {
      if (stepStatuses[step] === status) {
        return step;
      }
    }
  }
  return null;
}

async function ensureAutoFlowActive() {
  const runtime = await getRuntime();
  if (runtime.stopRequested) {
    throw createAutoRunPausedError('自动流程已暂停');
  }
}

async function runManagedStep(step, action, messages = {}) {
  const label = getStepLabel(step);
  const startMessage = messages.startMessage ?? `${label} 开始执行`;
  const successMessage = messages.successMessage ?? `${label} 已完成`;
  const failurePrefix = messages.failurePrefix ?? `${label} 失败`;

  await setStepStatus(step, 'running');
  if (startMessage) {
    await addLog(startMessage, 'info');
  }

  try {
    const result = await action();
    await setStepStatus(step, 'completed');
    if (successMessage) {
      await addLog(successMessage, 'ok');
    }
    return result;
  } catch (error) {
    const errorMessage = error?.message || String(error);
    await setStepStatus(step, 'failed');
    await addLog(`${failurePrefix}：${errorMessage}`, 'error');
    markErrorLogged(error);
    throw error;
  }
}

async function runContentDrivenStep(step, action, messages = {}) {
  const label = getStepLabel(step);
  const startMessage = messages.startMessage ?? '';
  const failurePrefix = messages.failurePrefix ?? `${label} 失败`;

  await setStepStatus(step, 'running');
  if (startMessage) {
    await addLog(startMessage, 'info');
  }

  try {
    const result = await action();
    await setStepStatus(step, 'completed');
    return result;
  } catch (error) {
    const errorMessage = error?.message || String(error);
    await setStepStatus(step, 'failed');
    if (!hasLoggedError(error)) {
      await addLog(`${failurePrefix}：${errorMessage}`, 'error');
      markErrorLogged(error);
    }
    throw error;
  }
}

function buildClient(settings) {
  return createLuckmailClient({
    apiKey: settings.apiKey,
    baseUrl: settings.mailApiBaseUrl,
    internalClient: settings.mailApiBaseUrl
      ? createInternalSessionClient({ baseUrl: settings.mailApiBaseUrl })
      : null,
  });
}

function getSelectedAccountAddress(state = {}) {
  return String(state.selectedAccountAddress || '').trim().toLowerCase();
}

async function resolvePinnedAccountSelection(state, accounts = []) {
  const selectedAddress = getSelectedAccountAddress(state);
  if (!selectedAddress) {
    return null;
  }

  const selection = findAvailableAccountByAddress(
    accounts,
    state.usedAccounts || {},
    selectedAddress
  );
  if (selection) {
    return selection;
  }

  await setRuntime({
    selectedAccountAddress: '',
    currentAccount: null,
    currentEmailRecord: null,
  });
  throw new Error(`手动指定邮箱不可用：${selectedAddress}，它可能已被标记为已使用或已注册`);
}

async function resolveCurrentAccount(state) {
  const client = buildClient(state);
  const accounts = await client.listAccounts();
  const selection = await resolvePinnedAccountSelection(state, accounts)
    || resolveCurrentAccountSelection({
      accounts,
      ledger: state.usedAccounts || {},
      startIndex: state.currentAccountIndex,
    });
  const account = selection?.account || null;
  if (!account) {
    throw new Error('没有可用邮箱，可能 Outlook API 中的邮箱都已打上“已注册”标签或已被跳过');
  }
  await setRuntime({
    currentAccount: account,
    currentAccountIndex: selection.index,
  });
  return account;
}

async function ensureCurrentAccount(state) {
  return state.currentAccount || resolveCurrentAccount(state);
}

async function ensureCurrentEmailRecord(state) {
  if (state.currentEmailRecord?.id) {
    return state.currentEmailRecord;
  }

  const account = await ensureCurrentAccount(state);
  const client = buildClient(state);
  const record = await client.findUserEmailByAddress(account.address);
  if (!record) {
    throw new Error(`邮件平台中未找到邮箱或别名：${account.address}`);
  }

  await setRuntime({ currentEmailRecord: record });
  return record;
}

async function getActiveAuthTab() {
  const state = await getState();
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabs = await chrome.tabs.query({});
  const tab = chooseOauthTabCandidate({
    currentTab: currentTab || null,
    tabs,
    preferredTabId: state.authTabId,
  }) || currentTab;
  if (!tab?.id) {
    throw new Error('未找到当前活动标签页');
  }
  if (state.authTabId !== tab.id) {
    await setRuntime({ authTabId: tab.id });
  }
  return tab;
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === 'complete') {
    return current;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`等待标签页加载完成超时，tabId=${tabId}`));
    }, timeoutMs);

    const listener = (updatedTabId, info, tab) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitForTabCompleteIfNeeded(tabId, shouldWait, timeoutMs = 30000) {
  if (!shouldWait) {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    return current;
  }
  return waitForTabComplete(tabId, timeoutMs);
}

async function sendMessageWithRetry(tabId, message, {
  timeoutMs = 15000,
  intervalMs = 250,
} = {}) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (!isMissingReceiverError(error)) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`认证页面脚本未就绪，等待超过 ${Math.round(timeoutMs / 1000)} 秒。${lastError?.message || ''}`.trim());
}

async function sendToActiveAuthTab(message, options) {
  const tab = await getActiveAuthTab();
  return sendMessageWithRetry(tab.id, message, options);
}

async function sendToTab(tabId, message, options) {
  return sendMessageWithRetry(tabId, message, options);
}

async function sendToActiveAuthTabOnce(message) {
  const tab = await getActiveAuthTab();
  return chrome.tabs.sendMessage(tab.id, message);
}

async function clickWithDebugger(tabId, rect) {
  if (!tabId) {
    throw new Error('未找到用于调试点击的认证页面标签页。');
  }
  if (!rect || !Number.isFinite(rect.centerX) || !Number.isFinite(rect.centerY)) {
    throw new Error('步骤 8 的调试器兜底点击需要有效的按钮坐标。');
  }

  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    const x = Math.round(rect.centerX);
    const y = Math.round(rect.centerY);

    await chrome.debugger.sendCommand(target, 'Page.bringToFront');
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      buttons: 0,
      clickCount: 0,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function openOauthUrl(oauthUrl) {
  if (!oauthUrl) {
    throw new Error('请先填写 OAuth URL');
  }

  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabs = await chrome.tabs.query({});
  const state = await getState();
  const tab = chooseOauthTabCandidate({
    currentTab: currentTab || null,
    tabs,
    preferredTabId: state.authTabId,
  });
  const plan = decideOauthTabNavigation({
    currentTab: tab,
    targetUrl: oauthUrl,
  });

  if (plan.action === 'reload' && plan.tabId) {
    await chrome.tabs.reload(plan.tabId, { bypassCache: true });
    const resolvedTab = await waitForTabComplete(plan.tabId);
    await setRuntime({ authTabId: plan.tabId });
    return resolvedTab;
  }

  if (plan.action === 'update' && plan.tabId) {
    await chrome.tabs.update(plan.tabId, { url: plan.url, active: true });
    const resolvedTab = await waitForTabComplete(plan.tabId);
    await setRuntime({ authTabId: plan.tabId });
    return resolvedTab;
  }

  const created = await chrome.tabs.create({ url: oauthUrl, active: true });
  const resolvedTab = await waitForTabComplete(created.id);
  await setRuntime({ authTabId: created.id });
  return resolvedTab;
}

async function closeAuthTabs() {
  const tabs = await chrome.tabs.query({});
  const authTabIds = listAuthTabIds(tabs);
  if (!authTabIds.length) {
    return 0;
  }
  await chrome.tabs.remove(authTabIds).catch(() => {});
  return authTabIds.length;
}

async function openOrReusePanelTab(source, url, files, options = {}) {
  if (!url) {
    throw new Error('缺少面板地址');
  }

  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url && tab.url.startsWith(url));
  const plan = buildPanelTabOpenPlan({
    existingTab: existing || null,
    targetUrl: url,
    preserveExistingTab: Boolean(options.preserveExistingTab),
  });

  let tab = null;
  if (plan.action === 'activate' && plan.tabId) {
    tab = await chrome.tabs.update(plan.tabId, { active: true });
  } else if (plan.action === 'reload' && plan.tabId) {
    await chrome.tabs.update(plan.tabId, { active: true });
    await chrome.tabs.reload(plan.tabId, { bypassCache: true });
    tab = await chrome.tabs.get(plan.tabId);
  } else if (plan.action === 'update' && plan.tabId) {
    tab = await chrome.tabs.update(plan.tabId, { url: plan.url, active: true });
  } else {
    tab = await chrome.tabs.create({ url, active: true });
  }

  if (options.preserveExistingTab && plan.action === 'activate' && readyCommandQueue.isReadyForTab(source, tab.id)) {
    return tab.id;
  }

  await waitForTabCompleteIfNeeded(tab.id, plan.waitForComplete, 30000);
  readyCommandQueue.markPending(source, tab.id);

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (injectedSource) => {
      window.__HOTMAIL_REGISTER_SOURCE = injectedSource;
    },
    args: [source],
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files,
  });

  return tab.id;
}

async function sendToReadySource(source, tabId, message, timeoutMs = 15000) {
  if (readyCommandQueue.isReady(source)) {
    return chrome.tabs.sendMessage(tabId, message);
  }
  return readyCommandQueue.queueCommand(source, message, timeoutMs);
}

async function syncCurrentAccount(state) {
  const account = await ensureCurrentAccount(state);
  const client = buildClient(state);
  return client.importEmails('ms_graph', [{
    address: account.address,
    password: account.password,
    client_id: account.clientId,
    refresh_token: account.refreshToken,
  }]);
}

async function pollCodeForPhase(state, phase) {
  const account = await ensureCurrentAccount(state);
  await ensureCurrentEmailRecord(state);
  const step = phase === 'signup' ? 4 : 7;
  const phaseLabel = phase === 'signup' ? '注册验证码' : '登录验证码';
  const phaseStartedAt = new Date().toISOString();
  const client = buildClient(state);
  const result = await pollVerificationCodeWithResend({
    step,
    maxRounds: 3,
    addLog,
    resendVerificationCode: async (targetStep) => {
      await ensureAutoFlowActive();
      await addLog(`步骤 ${targetStep}：正在请求新的验证码...`, 'warn');
      await sendToActiveAuthTab({
        type: 'RESEND_VERIFICATION_CODE',
        step: targetStep,
        payload: {},
      });
      return new Date().toISOString();
    },
    pollVerificationCode: async ({ minReceivedAt, round }) => {
      await ensureAutoFlowActive();
      return pollVerificationCode({
        client,
        detailFetcher: client,
        email: account.address,
        intervalMs: state.pollIntervalSec * 1000,
        timeoutMs: state.pollTimeoutSec * 1000,
        minReceivedAt: minReceivedAt || phaseStartedAt,
        freshnessGraceMs: 15000,
        addLog,
        step,
        round,
        maxRounds: 3,
        phaseLabel,
        shouldContinue: async () => {
          await ensureAutoFlowActive();
          return true;
        },
        match: {
          keyword: state.mailKeyword,
          fromIncludes: state.mailFromKeyword,
          subjectContains: state.mailKeyword,
        },
      });
    },
  });

  if (phase === 'signup') {
    await setRuntime({ lastSignupCode: result.code });
  } else {
    await setRuntime({ lastLoginCode: result.code });
  }
  const aliasText = result.matchedAlias ? `，别名命中 ${result.matchedAlias}` : '';
  const detailText = result.extractedFromDetail ? '（来自邮件详情）' : '';
  const olderText = result.usedOlderMatch ? '，使用了较早的匹配邮件' : '';
  await addLog(`步骤 ${step}：已锁定${phaseLabel}${detailText}${aliasText}${olderText}。`, 'info');
  return result;
}

async function broadcastStopFlow() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs
    .filter((tab) => tab.id)
    .map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'STOP_FLOW' }).catch(() => null)));
}

function getAutoRestartLabel(mode) {
  return mode === 'next' ? '切换到下一个账号' : '重启本轮';
}

async function queueAutoRestart(mode) {
  const label = getAutoRestartLabel(mode);
  await setRuntime({
    stopRequested: true,
    pendingAutoAction: mode,
  });
  await addLog(`已请求${label}，正在停止当前流程...`, 'warn');
  await broadcastStopFlow();
  return { queued: true, mode };
}

async function performAutoRestart(mode, state) {
  const latestState = state || await getState();
  const label = getAutoRestartLabel(mode);
  const runtimeUpdates = buildAutoRestartRuntimeUpdates({
    mode,
    currentAccountIndex: latestState.currentAccountIndex,
  });
  const resume = Boolean(latestState.autoCurrentRun);

  await setRuntime({
    ...runtimeUpdates,
    ...(mode === 'next' ? { selectedAccountAddress: '' } : {}),
    autoCurrentRun: latestState.autoCurrentRun || 1,
    autoTotalRuns: latestState.autoTotalRuns || latestState.runCount,
    pendingAutoAction: '',
  });
  await addLog(
    mode === 'next'
      ? `已切换到下一个账号，准备重新开始第 ${latestState.autoCurrentRun || 1}/${latestState.autoTotalRuns || latestState.runCount || 1} 轮`
      : `已重启当前账号，准备重新开始第 ${latestState.autoCurrentRun || 1}/${latestState.autoTotalRuns || latestState.runCount || 1} 轮`,
    'warn'
  );
  return runAutoFlow({ resume });
}

async function getSessionCookiesForBaseUrl(baseUrl) {
  if (!chrome.cookies?.getAll || !baseUrl) {
    return [];
  }
  try {
    return await chrome.cookies.getAll({ url: baseUrl });
  } catch {
    return [];
  }
}

async function syncRegisteredTagForState(state, account) {
  const record = state.currentEmailRecord;
  if (account?.isTemp || record?.isTemp) {
    await addLog('已注册标签同步跳过：当前账号属于临时邮箱来源', 'info');
    return { skipped: true, reason: 'temp_email' };
  }
  if (!state.mailApiBaseUrl) {
    await addLog('已注册标签同步跳过：未配置 API URL', 'warn');
    return { skipped: true, reason: 'missing_base_url' };
  }
  if (!record?.id) {
    await addLog('已注册标签同步跳过：当前账号缺少平台记录 ID', 'warn');
    return { skipped: true, reason: 'missing_account_id' };
  }

  const cookies = await getSessionCookiesForBaseUrl(state.mailApiBaseUrl);
  if (!cookies.length) {
    await addLog('已注册标签同步跳过：未检测到浏览器 Session Cookie', 'warn');
    return { skipped: true, reason: 'missing_session_cookie' };
  }

  await addLog(`已检测到 ${cookies.length} 个 Session Cookie，准备同步“已注册”标签...`, 'info');
  const client = createInternalSessionClient({
    baseUrl: state.mailApiBaseUrl,
  });
  const result = await client.markAccountRegistered({
    accountId: record.id,
    tagName: '已注册',
  });
  await addLog(
    result.created
      ? `已创建并打上“已注册”标签：${account.address}`
      : `已同步“已注册”标签：${account.address}`,
    'ok'
  );
  return result;
}

async function runAutoFlow({ resume = false } = {}) {
  const state = await getState();
  const totalRuns = resume && state.autoTotalRuns ? state.autoTotalRuns : state.runCount;
  const startIndex = resume && state.autoPaused ? Math.max(0, (state.autoCurrentRun || 1) - 1) : 0;
  let restartTriggered = false;
  await resetStepStatuses();
  await setRuntime({
    autoRunning: true,
    autoPaused: false,
    stopRequested: false,
    autoCurrentRun: startIndex + 1,
    autoTotalRuns: totalRuns,
  });

  try {
    const result = await runAutoFlowBatch({
      runCount: totalRuns,
      startIndex,
      continueOnError: false,
      runFlow: async (attempt) => {
        await setRuntime({ autoCurrentRun: attempt + 1, autoTotalRuns: totalRuns });
        await addLog(`=== 第 ${attempt + 1}/${totalRuns} 轮：开始执行自动流程 ===`, 'info');
        return runSingleAutoFlow({
        actions: {
          addLog,
          checkAutoControl: ensureAutoFlowActive,
          prepareNextAccount: handlers.PREPARE_NEXT_ACCOUNT,
          refreshOauthFromVps: handlers.GET_OAUTH_FROM_VPS,
          findCurrentEmailRecord: handlers.FIND_CURRENT_EMAIL_RECORD,
          openOauthUrl: handlers.OPEN_OAUTH_URL,
          executeSignupStep: async (step) => handlers.EXECUTE_SIGNUP_STEP({ step }),
          pollVerificationCode: async (phase) => handlers.POLL_VERIFICATION_CODE({ phase }),
          fillLastCode: async (phase) => handlers.FILL_LAST_CODE({ phase }),
          executeFinalVerifyStep: async () => handlers.EXECUTE_FINAL_VERIFY_STEP(),
          completeCurrentAccount: handlers.COMPLETE_CURRENT_ACCOUNT,
        },
      });
      },
      onAttemptError: async (error) => {
        const latestState = await getState();
        const failingAccount = latestState.currentAccount;
        const problemStep = findProblemStep(latestState.stepStatuses || {});
        const problemScope = problemStep ? getStepLabel(problemStep) : '自动流程';
        if (!hasLoggedError(error)) {
          await addLog(`${problemScope} 执行失败：${error.message || String(error)}`, 'error');
          markErrorLogged(error);
        }
        await addLog('当前流程已停止，可点击“继续”从失败步骤接着执行。', 'warn');
      },
      onPaused: async (resumeIndex) => {
        await setRuntime({
          autoRunning: false,
          autoPaused: true,
          stopRequested: false,
          autoCurrentRun: resumeIndex + 1,
          autoTotalRuns: totalRuns,
        });
        await addLog(`自动流程已暂停，将从第 ${resumeIndex + 1}/${totalRuns} 轮重新开始当前账号`, 'warn');
      },
    });

    const latestState = await getState();
    if (result.pausedAt != null && latestState.pendingAutoAction) {
      restartTriggered = true;
      await performAutoRestart(latestState.pendingAutoAction, latestState);
    }
    return result;
  } finally {
    if (restartTriggered) {
      return;
    }
    const latestState = await getState();
    if (!latestState.autoPaused) {
      await setRuntime({
        autoRunning: false,
        stopRequested: false,
        autoCurrentRun: 0,
        autoTotalRuns: 0,
        pendingAutoAction: '',
      });
    }
  }
}

const handlers = {
  async GET_STATE() {
    return getState();
  },
  async SAVE_SETTINGS(payload) {
    await setSettings(payload || {});
    await addLog('设置已保存', 'ok');
    return getState();
  },
  async CLEAR_LOGS() {
    await setRuntime({ logs: [] });
    return { ok: true };
  },
  async PARSE_ACCOUNT_POOL(payload) {
    const state = await getState();
    const accounts = await buildClient(state).listAccounts();
    await addLog(`邮箱池已从 Outlook API 拉取完成，共 ${accounts.length} 条`, 'ok');
    return { count: accounts.length, first: accounts[0] || null };
  },
  async LIST_AVAILABLE_ACCOUNTS(payload) {
    const state = await getState();
    const accounts = await buildClient(state).listAccounts();
    const availableAccounts = listAvailableAccounts(accounts, state.usedAccounts || {}, {
      query: payload?.query || '',
      limit: 30,
    }).map((account) => ({
      address: account.address,
      provider: account.provider || '',
      groupName: account.groupName || '',
      isTemp: Boolean(account.isTemp),
    }));
    return {
      accounts: availableAccounts,
      selectedAccountAddress: getSelectedAccountAddress(state),
    };
  },
  async SELECT_ACCOUNT(payload) {
    const state = await getState();
    const requestedAddress = String(payload?.address || '').trim().toLowerCase();

    if (!requestedAddress) {
      await setRuntime({
        selectedAccountAddress: '',
        currentAccount: null,
        currentEmailRecord: null,
      });
      await addLog('已清除手动指定邮箱', 'info');
      return { selectedAccountAddress: '' };
    }

    const accounts = await buildClient(state).listAccounts();
    const selection = findAvailableAccountByAddress(accounts, state.usedAccounts || {}, requestedAddress);
    if (!selection?.account?.address) {
      throw new Error(`未找到可用邮箱：${requestedAddress}`);
    }

    await setRuntime({
      selectedAccountAddress: selection.account.address,
      currentAccount: selection.account,
      currentAccountIndex: selection.index,
      currentEmailRecord: null,
    });
    await addLog(`已手动指定邮箱：${selection.account.address}`, 'ok');
    return {
      selectedAccountAddress: selection.account.address,
      account: selection.account,
    };
  },
  async GET_OAUTH_FROM_VPS() {
    const state = await getState();
    if (!state.vpsUrl) {
      throw new Error('请先填写 CPA 地址');
    }
    return runManagedStep(1, async () => {
      const tabId = await openOrReusePanelTab('vps-panel', state.vpsUrl, [
        'content/utils.js',
        'shared/oauth-step-helpers-runtime.js',
        'shared/step9-status.js',
        'content/vps-panel.js',
      ]);
      const result = await sendToReadySource('vps-panel', tabId, {
        type: 'EXECUTE_STEP',
        step: 1,
        payload: { vpsPassword: state.vpsPassword },
      }, 15000);
      if (result?.oauthUrl) {
        await setSettings({ oauthUrl: result.oauthUrl });
        return { oauthUrl: result.oauthUrl };
      }
      return result;
    }, {
      startMessage: '步骤 1：正在从 CPA 面板抓取 OAuth 链接...',
      successMessage: '步骤 1：已从 CPA 面板获取 OAuth 链接',
    });
  },
  async PREPARE_NEXT_ACCOUNT() {
    const state = await getState();
    await addLog('准备账号：正在从邮箱平台拉取可用账号...', 'info');
    const accounts = await buildClient(state).listAccounts();
    const selection = await resolvePinnedAccountSelection(state, accounts)
      || resolveCurrentAccountSelection({
        accounts,
        ledger: state.usedAccounts || {},
        startIndex: state.currentAccountIndex,
      });
    const match = selection?.account || null;
    if (!match?.address) {
      const summary = summarizeAccountAvailability(accounts, state.usedAccounts || {});
      const skipped = listSkippedAccounts(accounts, state.usedAccounts || {});
      await addLog(
        `准备账号：本次共扫描 ${summary.total} 个邮箱，本地已用 ${summary.completedInLedger} 个，已注册标签 ${summary.taggedRegistered} 个，可用 ${summary.available} 个。`,
        'warn'
      );
      if (skipped.completedInLedger.length) {
        await addLog(`准备账号：被本地账本跳过的邮箱：${skipped.completedInLedger.join(', ')}`, 'warn');
      }
      if (skipped.taggedRegistered.length) {
        await addLog(`准备账号：被“已注册”标签跳过的邮箱：${skipped.taggedRegistered.join(', ')}`, 'warn');
      }
      throw new Error('没有更多未注册邮箱可用');
    }
    await setRuntime({
      currentAccount: match,
      currentAccountIndex: selection.index,
      currentEmailRecord: null,
    });
    await addLog(`当前账号：${match.address}`, 'ok');
    return match;
  },
  async ADVANCE_ACCOUNT() {
    const state = await getState();
    await setRuntime({ selectedAccountAddress: '' });
    const accounts = await buildClient(state).listAccounts();
    const selection = resolveCurrentAccountSelection({
      accounts,
      ledger: state.usedAccounts || {},
      startIndex: Number(state.currentAccountIndex || 0) + 1,
    });
    const nextAccount = selection?.account || null;
    if (!nextAccount?.address) {
      throw new Error('没有更多未注册邮箱可用');
    }
    await setRuntime({
      selectedAccountAddress: '',
      currentAccountIndex: selection.index,
      currentAccount: nextAccount,
      currentEmailRecord: null,
    });
    await addLog(`当前账号：${nextAccount.address}`, 'ok');
    return nextAccount;
  },
  async COMPLETE_CURRENT_ACCOUNT() {
    const state = await getState();
    const account = await ensureCurrentAccount(state);
    const usedAccounts = markAccountStatus(state.usedAccounts || {}, account.address, 'completed');
    await setSettings({ usedAccounts });
    try {
      await syncRegisteredTagForState(state, account);
    } catch (error) {
      await addLog(`已注册标签同步失败：${error.message || String(error)}`, 'warn');
    }
    const closedAuthTabs = await closeAuthTabs();
    await resetTransientRuntime();
    if (closedAuthTabs) {
      await addLog(`已关闭 ${closedAuthTabs} 个 OpenAI 认证页标签`, 'info');
    }
    await addLog(`已标记邮箱为已使用：${account.address}`, 'ok');
    return { address: account.address, status: 'completed' };
  },
  async RESET_ACCOUNT_LEDGER() {
    await setSettings({ usedAccounts: {} });
    await addLog('已清空已用邮箱账本', 'warn');
    return { ok: true };
  },
  async AUTO_RUN_CURRENT() {
    return runAutoFlow();
  },
  async PAUSE_AUTO_RUN() {
    const state = await getState();
    if (!state.autoRunning) {
      return { paused: false, reason: 'not_running' };
    }
    await setRuntime({ stopRequested: true });
    await addLog('已收到暂停请求，当前步骤结束后将暂停自动流程', 'warn');
    await broadcastStopFlow();
    return { paused: true };
  },
  async RESUME_AUTO_RUN() {
    const state = await getState();
    if (!state.autoPaused) {
      throw new Error('当前没有已暂停的自动流程');
    }
    if (!state.currentAccount?.address) {
      await addLog(`正在继续自动流程，将从第 ${state.autoCurrentRun}/${state.autoTotalRuns || state.runCount} 轮重新开始当前账号`, 'info');
      return runAutoFlow({ resume: true });
    }

    await setRuntime({
      autoRunning: true,
      autoPaused: false,
      stopRequested: false,
    });
    await addLog(`正在继续自动流程，将从当前中断步骤接着执行`, 'info');

    try {
      return await continueSingleAutoFlow({
        state,
        actions: {
          addLog,
          checkAutoControl: ensureAutoFlowActive,
          refreshOauthFromVps: handlers.GET_OAUTH_FROM_VPS,
          findCurrentEmailRecord: handlers.FIND_CURRENT_EMAIL_RECORD,
          openOauthUrl: handlers.OPEN_OAUTH_URL,
          executeSignupStep: async (step) => handlers.EXECUTE_SIGNUP_STEP({ step }),
          pollVerificationCode: async (phase) => handlers.POLL_VERIFICATION_CODE({ phase }),
          fillLastCode: async (phase) => handlers.FILL_LAST_CODE({ phase }),
          executeFinalVerifyStep: async () => handlers.EXECUTE_FINAL_VERIFY_STEP(),
          completeCurrentAccount: handlers.COMPLETE_CURRENT_ACCOUNT,
        },
      });
    } finally {
      await setRuntime({
        autoRunning: false,
        autoPaused: false,
        stopRequested: false,
      });
    }
  },
  async CONTINUE_AUTO_RUN() {
    const state = await getState();
    const problemStep = findProblemStep(state.stepStatuses || {});
    if (!problemStep) {
      throw new Error('当前没有可继续的失败步骤');
    }
    if (!state.currentAccount?.address) {
      throw new Error('当前缺少失败现场账号信息，无法继续');
    }

    await setRuntime({
      autoRunning: true,
      autoPaused: false,
      stopRequested: false,
    });
    await addLog(`正在继续自动流程，将从 ${getStepLabel(problemStep)} 接着执行`, 'info');

    try {
      return await continueSingleAutoFlow({
        state,
        actions: {
          addLog,
          checkAutoControl: ensureAutoFlowActive,
          refreshOauthFromVps: handlers.GET_OAUTH_FROM_VPS,
          findCurrentEmailRecord: handlers.FIND_CURRENT_EMAIL_RECORD,
          openOauthUrl: handlers.OPEN_OAUTH_URL,
          executeSignupStep: async (step) => handlers.EXECUTE_SIGNUP_STEP({ step }),
          pollVerificationCode: async (phase) => handlers.POLL_VERIFICATION_CODE({ phase }),
          fillLastCode: async (phase) => handlers.FILL_LAST_CODE({ phase }),
          executeFinalVerifyStep: async () => handlers.EXECUTE_FINAL_VERIFY_STEP(),
          completeCurrentAccount: handlers.COMPLETE_CURRENT_ACCOUNT,
        },
      });
    } finally {
      await setRuntime({
        autoRunning: false,
        autoPaused: false,
        stopRequested: false,
      });
    }
  },
  async RESTART_CURRENT_RUN() {
    const state = await getState();
    if (state.autoRunning) {
      return queueAutoRestart('current');
    }
    return performAutoRestart('current', state);
  },
  async RESTART_WITH_NEXT_ACCOUNT() {
    const state = await getState();
    if (state.autoRunning) {
      return queueAutoRestart('next');
    }
    return performAutoRestart('next', state);
  },
  async EXECUTE_FINAL_VERIFY_STEP() {
    const state = await getState();
    if (!state.localhostUrl) {
      throw new Error('缺少 localhost 回调地址，请先完成步骤 8。');
    }
    if (!state.vpsUrl) {
      throw new Error('请先填写 CPA 地址');
    }
    return runManagedStep(9, async () => {
      const tabId = await openOrReusePanelTab('vps-panel', state.vpsUrl, [
        'content/utils.js',
        'shared/oauth-step-helpers-runtime.js',
        'shared/step9-status.js',
        'content/vps-panel.js',
      ], {
        preserveExistingTab: true,
      });
      const result = await sendToReadySource('vps-panel', tabId, {
        type: 'EXECUTE_STEP',
        step: 9,
        payload: {
          localhostUrl: state.localhostUrl,
          vpsPassword: state.vpsPassword,
        },
      }, 15000);
      return result;
    }, {
      startMessage: '步骤 9：正在把 localhost 回调地址回填到 CPA 面板...',
      successMessage: '步骤 9：CPA 面板校验完成',
    });
  },
  async SYNC_CURRENT_ACCOUNT() {
    await addLog('当前平台不需要在插件内同步邮箱，请在平台后台维护邮箱池', 'info');
    const result = { skipped: true };
    return result;
  },
  async FIND_CURRENT_EMAIL_RECORD() {
    const state = await getState();
    const record = await ensureCurrentEmailRecord(state);
    const hitText = record.matchedAlias
      ? `已定位平台邮箱记录：${record.address}（别名命中 ${record.matchedAlias}）`
      : `已定位平台邮箱记录：${record.address}`;
    await addLog(hitText, 'ok');
    return record;
  },
  async OPEN_OAUTH_URL() {
    const state = await getState();
    await openOauthUrl(state.oauthUrl);
    await addLog('已打开 OAuth 页面', 'ok');
    return { ok: true };
  },
  async EXECUTE_SIGNUP_STEP(payload) {
    const state = await getState();
    if (payload?.step === 1) {
      return handlers.GET_OAUTH_FROM_VPS();
    }
    const step = Number(payload?.step || 0);
    if (!step) {
      throw new Error('缺少 step 参数');
    }

    if (step === 2 || step === 3) {
      return runContentDrivenStep(step, async () => {
        const state = await getState();
        const waitForPageStep = contentStepSignals.waitForStep(step, step === 3 ? 45000 : 20000);
        void executeSignupStepCommand({
          step,
          payload,
          state,
          ensureCurrentAccount,
          openOauthUrl,
          addLog,
          sendToActiveAuthTab,
          sendToTab,
        }).then((dispatchResult) => {
          settleStepWaiterFromDispatchResult(contentStepSignals, step, dispatchResult);
        }).catch((error) => {
          if (!isMissingReceiverError(error)) {
            contentStepSignals.rejectStep(step, error);
          }
        });
        return await waitForPageStep;
      });
    }

    if (step === 8) {
      return runManagedStep(8, () => new Promise(async (resolve, reject) => {
        let resolved = false;
        let webNavListener = null;

        const cleanupListener = () => {
          if (webNavListener) {
            chrome.webNavigation.onBeforeNavigate.removeListener(webNavListener);
            webNavListener = null;
          }
        };

        const finishStep8WithCallbackUrl = async (url) => {
          const matchedUrl = findLoopbackCallbackUrl([url]);
          if (!matchedUrl || resolved) return false;

          resolved = true;
          cleanupListener();
          clearTimeout(timeout);
          await setRuntime({ localhostUrl: matchedUrl });
          await setStepStatus(8, 'completed');
          await addLog(`步骤 8：已捕获 localhost 回调 ${matchedUrl.slice(0, 80)}...`, 'ok');
          resolve({ localhostUrl: matchedUrl });
          return true;
        };

        const timeout = setTimeout(async () => {
          cleanupListener();
          resolved = true;
          await setStepStatus(8, 'failed');
          reject(new Error('120 秒内未捕获到 localhost 回调跳转。'));
        }, 120000);

        webNavListener = (details) => {
          const matchedUrl = findLoopbackCallbackUrl([details.url]);
          if (matchedUrl) {
            void finishStep8WithCallbackUrl(matchedUrl);
          }
        };

        chrome.webNavigation.onBeforeNavigate.addListener(webNavListener);

        try {
          await addLog('步骤 8：正在监听 localhost 回调地址...', 'info');
          const authTab = await getActiveAuthTab();
          const clickResult = await chrome.tabs.sendMessage(authTab.id, {
            type: 'STEP8_FIND_AND_CLICK',
            payload: {},
          });

          if (clickResult?.error) {
            throw new Error(clickResult.error);
          }

          const clickPlan = decideStep8ClickPlan({
            nativeClicked: Boolean(clickResult?.clicked),
            hasRect: Boolean(clickResult?.rect),
          });

          if (clickPlan === 'no_click_available') {
            throw new Error('步骤 8：未能获取可点击的 Continue 按钮。');
          }

          if (clickPlan === 'debugger_only') {
            await clickWithDebugger(authTab.id, clickResult.rect);
            await addLog('步骤 8：已发送调试器点击，正在等待跳转...', 'info');
          } else if (clickPlan === 'native_only') {
            await addLog('步骤 8：已发送页面内点击，正在等待跳转...', 'info');
          } else {
            await addLog('步骤 8：已发送页面内点击，若未跳转将自动补发调试器点击...', 'info');
            setTimeout(() => {
              if (!resolved && clickResult?.rect) {
                void clickWithDebugger(authTab.id, clickResult.rect)
                  .then(() => addLog('步骤 8：已补发调试器点击，继续等待跳转...', 'info'))
                  .catch(() => null);
              }
            }, 1500);
          }

          (async () => {
            while (!resolved) {
              const tab = await chrome.tabs.get(authTab.id).catch(() => null);
              const matchedUrl = findLoopbackCallbackUrl([tab?.url || '']);
              if (matchedUrl) {
                await finishStep8WithCallbackUrl(matchedUrl);
                return;
              }
              await new Promise((resume) => setTimeout(resume, 250));
            }
          })().catch(async (error) => {
            if (!resolved) {
              clearTimeout(timeout);
              cleanupListener();
              reject(error);
            }
          });
        } catch (error) {
          clearTimeout(timeout);
          cleanupListener();
          reject(error);
        }
      }), {
        startMessage: '步骤 8：正在确认 OAuth 同意页并准备点击继续...',
        successMessage: '步骤 8：已确认 OAuth 授权并捕获回调地址',
      });
    }

    return runManagedStep(step, async () => {
      if (step === 6) {
        const account = await ensureCurrentAccount(state);
        const loginPassword = resolveLoginPassword({
          defaultLoginPassword: state.defaultLoginPassword,
          accountPassword: account.password,
        });
        const authTab = await openOauthUrl(state.oauthUrl);
        await addLog('步骤 6：已重新打开 OAuth 页面，准备登录...', 'info');
        return sendToTab(authTab.id, {
          type: 'EXECUTE_STEP',
          step,
          payload: {
            ...account,
            loginPassword,
          },
        });
      }
      return executeSignupStepCommand({
        step,
        payload,
        state,
        ensureCurrentAccount,
        openOauthUrl,
        addLog,
        sendToActiveAuthTab: step === 3 ? sendToActiveAuthTabOnce : sendToActiveAuthTab,
        sendToTab,
      });
    }, {
      startMessage: {
        2: '',
        3: '',
        5: '步骤 5：正在填写基础资料...',
        6: '步骤 6：正在刷新 OAuth 页面并执行登录...',
      }[step] ?? `${getStepLabel(step)} 开始执行`,
      successMessage: {
        2: '',
        3: '',
        5: '步骤 5：基础资料已提交',
        6: '步骤 6：登录操作已提交，准备进入验证码阶段',
      }[step] ?? `${getStepLabel(step)} 已完成`,
    });
  },
  async POLL_VERIFICATION_CODE(payload) {
    const state = await getState();
    const phase = payload?.phase === 'login' ? 'login' : 'signup';
    const step = phase === 'signup' ? 4 : 7;
    return runManagedStep(step, async () => {
      const result = await pollCodeForPhase(state, phase);
      await addLog(`${phase === 'signup' ? '注册' : '登录'}验证码：${result.code}`, 'ok');
      return result;
    }, {
      startMessage: `步骤 ${step}：正在轮询${phase === 'signup' ? '注册' : '登录'}验证码...`,
      successMessage: `步骤 ${step}：已收到${phase === 'signup' ? '注册' : '登录'}验证码`,
    });
  },
  async FILL_LAST_CODE(payload) {
    const state = await getState();
    const phase = payload?.phase === 'login' ? 'login' : 'signup';
    const code = phase === 'signup' ? state.lastSignupCode : state.lastLoginCode;
    const step = phase === 'signup' ? 4 : 7;
    if (!code) {
      throw new Error('当前没有可填写的验证码');
    }
    return runManagedStep(step, async () => {
      return sendToActiveAuthTab({ type: 'FILL_CODE', step, payload: { code } });
    }, {
      startMessage: '',
      successMessage: '',
      failurePrefix: `步骤 ${step}：验证码回填失败`,
    });
  },
};

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanelAction();
});

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanelAction();
});

void configureSidePanelAction();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LOG') {
    addLog(message.payload?.message || '', message.payload?.level || 'info')
      .then(() => sendResponse({ ok: true, data: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === 'STEP_COMPLETE') {
    Promise.all([
      setStepStatus(message.step, 'completed'),
      message.payload?.localhostUrl ? setRuntime({ localhostUrl: message.payload.localhostUrl }) : Promise.resolve(),
      addLog(`页面内步骤 ${message.step} 已完成`, 'ok'),
    ])
      .then(() => {
        contentStepSignals.resolveStep(message.step, message.payload || { ok: true });
        sendResponse({ ok: true, data: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === 'STEP_ERROR') {
    const stepError = new Error(message.error || '未知错误');
    markErrorLogged(stepError);
    Promise.all([
      setStepStatus(message.step, 'failed'),
      addLog(`页面内步骤 ${message.step} 失败：${message.error || '未知错误'}`, 'error'),
    ])
      .then(() => {
        contentStepSignals.rejectStep(message.step, stepError);
        sendResponse({ ok: true, data: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === 'CONTENT_SCRIPT_READY') {
    const source = message.source || 'unknown';
    const tabId = _sender?.tab?.id || null;
    addLog(`页面脚本已就绪：${source}`, 'info')
      .then(async () => {
        readyCommandQueue.markReady(source, tabId);
        if (tabId) {
          await readyCommandQueue.flushReadyCommand(source, (queuedMessage) => chrome.tabs.sendMessage(tabId, queuedMessage)).catch(() => null);
        }
        sendResponse({ ok: true, data: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  const handler = handlers[message?.type];
  if (!handler) {
    sendResponse({ ok: false, error: `未知消息类型：${message?.type}` });
    return;
  }

  handler(message.payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch(async (error) => {
      if (!hasLoggedError(error)) {
        await addLog(error.message || String(error), 'error');
      }
      sendResponse({ ok: false, error: error.message || String(error) });
    });

  return true;
});
