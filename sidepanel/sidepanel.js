import { setButtonBusyState } from '../shared/button-busy-state.js';
import { getAutoRunPrimaryControl, getAutoRunRestartLabel } from '../shared/auto-run-controls.js';
import { getLogAreaScrollTop, isScrollNearBottom } from '../shared/log-scroll.js';

const $ = (id) => document.getElementById(id);

const STEP_STATUS_ICONS = {
  pending: '',
  running: '…',
  completed: '✓',
  failed: '✕',
};

const LOG_LEVEL_LABELS = {
  info: 'INFO',
  ok: 'OK',
  warn: 'WARN',
  error: 'ERR',
};

const TOAST_ICONS = {
  info: 'i',
  success: '✓',
  warn: '!',
  error: '✕',
};

const EYE_STATES = {
  hidden: '◉',
  visible: '◎',
};

const STEP_DEFAULT_STATUSES = {
  1: 'pending',
  2: 'pending',
  3: 'pending',
  4: 'pending',
  5: 'pending',
  6: 'pending',
  7: 'pending',
  8: 'pending',
  9: 'pending',
};

const formIds = [
  'api-key',
  'mail-api-base-url',
  'apple-email-base-url',
  'default-login-password',
  'oauth-url',
  'vps-url',
  'vps-password',
  'run-count',
  'poll-interval',
  'poll-timeout',
  'account-pool-text',
];

const actionButtonIds = [
  'save-settings',
  'auto-run-current',
  'restart-current-run',
  'restart-next-account',
  'step-1',
  'step-2',
  'step-3',
  'poll-signup-code',
  'fill-signup-code',
  'step-5',
  'step-6',
  'poll-login-code',
  'fill-login-code',
  'step-8',
  'step-9',
  'complete-flow',
];

const elements = {
  saveButton: $('save-settings'),
  saveHint: $('save-hint'),
  stepsProgress: $('steps-progress'),
  logArea: $('log-area'),
  toastContainer: $('toast-container'),
  copyLogsButton: $('copy-logs'),
  clearLogsButton: $('clear-logs'),
  toggleApiKeyButton: $('toggle-api-key'),
  toggleDefaultLoginPasswordButton: $('toggle-default-login-password'),
  toggleVpsPasswordButton: $('toggle-vps-password'),
  autoRunButton: $('auto-run-current'),
  restartCurrentButton: $('restart-current-run'),
  restartNextButton: $('restart-next-account'),
  accountSearchInput: $('account-search'),
  accountSearchStatus: $('account-search-status'),
  accountSearchResults: $('account-search-results'),
  selectedAccountHint: $('selected-account-hint'),
  clearSelectedAccountButton: $('clear-selected-account'),
};

let latestState = null;
let formDirty = false;
let formHydrated = false;
let refreshInFlight = false;
let refreshTimer = null;
let accountSearchResults = [];
let accountSearchLoading = false;
let accountSearchRequestId = 0;
let accountSearchDebounceTimer = null;
let accountSearchTempEmailStatus = null;

async function call(type, payload) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) {
    throw new Error(response?.error || '未知错误');
  }
  return response.data;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function getButton(id) {
  return $(id);
}

function isButtonBusy(button) {
  return Boolean(button?.dataset.busy === '1');
}

function setButtonBusy(button, busy, loadingText = '处理中...') {
  setButtonBusyState(button, busy, loadingText);
}

function flashButton(button, className) {
  if (!button) return;
  button.classList.remove('is-success', 'is-error');
  void button.offsetWidth;
  button.classList.add(className);
  setTimeout(() => button.classList.remove(className), 900);
}

function showToast(message, type = 'info', duration = 2200) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, duration);
}

function toggleSecretInput(inputId, button, visibleTitle, hiddenTitle) {
  const input = $(inputId);
  if (!input || !button) return;
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  button.textContent = visible ? EYE_STATES.hidden : EYE_STATES.visible;
  button.title = visible ? hiddenTitle : visibleTitle;
  button.setAttribute('aria-label', button.title);
}

function getStepStatuses(state = latestState) {
  return { ...STEP_DEFAULT_STATUSES, ...(state?.stepStatuses || {}) };
}

function getCompletedCount(state = latestState) {
  return Object.values(getStepStatuses(state)).filter((status) => status === 'completed').length;
}

function getFirstStepByStatus(targetStatus, state = latestState) {
  const statuses = getStepStatuses(state);
  for (let step = 1; step <= 9; step += 1) {
    if (statuses[step] === targetStatus) {
      return step;
    }
  }
  return null;
}

function updateSaveUI() {
  if (!elements.saveButton || !elements.saveHint) return;

  elements.saveButton.disabled = !formDirty || isButtonBusy(elements.saveButton) || Boolean(latestState?.autoRunning);
  elements.saveHint.classList.remove('is-dirty', 'is-saving');

  if (isButtonBusy(elements.saveButton)) {
    elements.saveHint.textContent = '保存中...';
    elements.saveHint.classList.add('is-saving');
    return;
  }

  if (formDirty) {
    elements.saveHint.textContent = '有修改待保存';
    elements.saveHint.classList.add('is-dirty');
    return;
  }

  elements.saveHint.textContent = '已保存';
}

function markDirty() {
  formDirty = true;
  updateSaveUI();
}

function hydrateForm(state) {
  $('api-key').value = state.apiKey || '';
  $('mail-api-base-url').value = state.mailApiBaseUrl || '';
  $('apple-email-base-url').value = state.appleEmailBaseUrl || '';
  $('default-login-password').value = state.defaultLoginPassword || '';
  $('oauth-url').value = state.oauthUrl || '';
  $('vps-url').value = state.vpsUrl || '';
  $('vps-password').value = state.vpsPassword || '';
  $('run-count').value = state.runCount || 1;
  $('poll-interval').value = state.pollIntervalSec || 3;
  $('poll-timeout').value = state.pollTimeoutSec || 60;
  $('account-pool-text').value = state.accountPoolText || '';
  updateProviderUI(state.mailProvider || 'outlook');
  updateAccountPoolCount();
}

function renderSteps(state) {
  const statuses = getStepStatuses(state);
  for (let step = 1; step <= 9; step += 1) {
    const status = statuses[step];
    const row = document.querySelector(`.step-row[data-step="${step}"]`);
    const indicator = document.querySelector(`.step-status[data-step="${step}"]`);
    if (!row || !indicator) continue;

    row.classList.remove('is-running', 'is-success', 'is-error');
    if (status === 'running') row.classList.add('is-running');
    if (status === 'completed') row.classList.add('is-success');
    if (status === 'failed') row.classList.add('is-error');
    indicator.textContent = STEP_STATUS_ICONS[status] || '';
  }

  elements.stepsProgress.textContent = `${getCompletedCount(state)} / 9`;
}

function extractStepTag(message) {
  const match = String(message || '').match(/(?:步骤|Step)\s*(\d+)/i);
  return match?.[1] || '';
}

function renderLogs(state) {
  const preserveScrollTop = elements.logArea.scrollTop;
  const stickToBottom = isScrollNearBottom(elements.logArea) || !elements.logArea.childElementCount;
  const logs = state.logs || [];
  if (!logs.length) {
    elements.logArea.innerHTML = '<div class="log-empty">暂无日志，等待下一次操作。</div>';
    elements.logArea.scrollTop = 0;
    return;
  }

  elements.logArea.innerHTML = logs
    .map((entry) => {
      const timestamp = entry.timestamp
        ? new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })
        : '--:--:--';
      const level = ['info', 'ok', 'warn', 'error'].includes(entry.level) ? entry.level : 'info';
      const levelLabel = LOG_LEVEL_LABELS[level];
      const stepTag = extractStepTag(entry.message);
      return `
        <div class="log-line log-${level}">
          <span class="log-time">${escapeHtml(timestamp)}</span>
          <span class="log-level log-level-${level}">${levelLabel}</span>
          ${stepTag ? `<span class="log-step">步${escapeHtml(stepTag)}</span>` : ''}
          <span class="log-msg">${escapeHtml(entry.message)}</span>
        </div>
      `;
    })
    .join('');

  elements.logArea.scrollTop = getLogAreaScrollTop({
    preserveScrollTop,
    nextScrollHeight: elements.logArea.scrollHeight,
    stickToBottom,
  });
}

function formatAccountMeta(account = {}) {
  const meta = [];
  if (account.isAlias && account.baseAddress) {
    meta.push(`原邮箱 ${account.baseAddress}`);
  }
  if (account.provider) {
    meta.push(account.provider);
  }
  if (account.groupName) {
    meta.push(account.groupName);
  }
  if (account.isTemp) {
    meta.push('临时邮箱');
  }
  return meta.join(' · ');
}

function renderAccountPicker(state = latestState) {
  const input = elements.accountSearchInput;
  const status = elements.accountSearchStatus;
  const results = elements.accountSearchResults;
  const selectedHint = elements.selectedAccountHint;
  const clearButton = elements.clearSelectedAccountButton;
  if (!input || !status || !results || !selectedHint || !clearButton) {
    return;
  }

  const locked = Boolean(state?.autoRunning || state?.autoPaused);
  const selectedAddress = String(state?.selectedAccountAddress || '').trim();
  const selectedAccount = accountSearchResults.find((account) => account.address === selectedAddress)
    || (state?.currentAccount?.address === selectedAddress ? state.currentAccount : null);
  const query = input.value.trim();

  input.disabled = locked;
  if (!isButtonBusy(clearButton)) {
    clearButton.disabled = locked || !selectedAddress;
  }

  selectedHint.textContent = selectedAddress
    ? (selectedAccount?.isAlias && selectedAccount?.baseAddress
      ? `已指定：${selectedAddress}（原邮箱 ${selectedAccount.baseAddress}）`
      : `已指定：${selectedAddress}`)
    : '未指定：将使用第一个可用邮箱';
  selectedHint.classList.toggle('is-active', Boolean(selectedAddress));

  if (accountSearchLoading) {
    status.textContent = '正在加载可用邮箱...';
  } else if (accountSearchTempEmailStatus?.needLogin && !accountSearchResults.length) {
    status.textContent = '临时邮箱未纳入搜索：请先在当前浏览器登录邮箱后台';
  } else if (accountSearchTempEmailStatus?.needLogin) {
    status.textContent = query
      ? `当前显示 ${accountSearchResults.length} 个匹配邮箱；临时邮箱未纳入搜索，请先登录邮箱后台`
      : `当前显示前 ${accountSearchResults.length} 个可用邮箱；临时邮箱未纳入搜索，请先登录邮箱后台`;
  } else if (!accountSearchResults.length && query) {
    status.textContent = `没有匹配 “${query}” 的可用邮箱`;
  } else if (!accountSearchResults.length) {
    status.textContent = '暂无可用邮箱，请检查邮箱平台或更换关键字';
  } else {
    status.textContent = query
      ? `当前显示 ${accountSearchResults.length} 个匹配邮箱，点击即可指定`
      : `当前显示前 ${accountSearchResults.length} 个可用邮箱，未指定时默认使用第一个`;
  }

  results.innerHTML = accountSearchResults.map((account) => {
    const active = account.address === selectedAddress;
    const meta = formatAccountMeta(account);
    return `
      <button
        class="picker-result ${active ? 'is-active' : ''}"
        type="button"
        data-account-address="${escapeHtml(account.address)}"
        ${locked ? 'disabled' : ''}
      >
        <span class="picker-result-main">
          <span class="picker-result-address mono">${escapeHtml(account.address)}</span>
          ${meta ? `<span class="picker-result-meta">${escapeHtml(meta)}</span>` : ''}
        </span>
        <span class="picker-result-action">${active ? '已选中' : '选择'}</span>
      </button>
    `;
  }).join('');
}

function buildPlainLogs(state = latestState) {
  const logs = state?.logs || [];
  return logs.map((entry) => {
    const timestamp = entry.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })
      : '--:--:--';
    const level = LOG_LEVEL_LABELS[entry.level] || String(entry.level || 'INFO').toUpperCase();
    return `${timestamp} ${level} ${entry.message}`;
  }).join('\n');
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function renderState(state) {
  latestState = state;

  if (!formHydrated || !formDirty) {
    hydrateForm(state);
    formHydrated = true;
  }

  renderSteps(state);
  renderLogs(state);
  renderAccountPicker(state);
  updateAutoRunButton(state);
  updateRecoveryButton(state);
  updateSaveUI();
  updateActionAvailability(state);
}

function updateRecoveryButton(state = latestState) {
  const button = elements.restartCurrentButton;
  if (!button || isButtonBusy(button)) return;
  button.textContent = getAutoRunRestartLabel(state);
}

function updateAutoRunButton(state = latestState) {
  const button = elements.autoRunButton;
  if (!button || isButtonBusy(button)) return;
  button.textContent = getAutoRunPrimaryControl(state).label;
}

function collectSettings() {
  const provider = $('mail-provider').value || 'outlook';
  return {
    apiKey: $('api-key').value.trim(),
    mailApiBaseUrl: $('mail-api-base-url').value.trim(),
    appleEmailBaseUrl: $('apple-email-base-url').value.trim(),
    defaultLoginPassword: $('default-login-password').value,
    oauthUrl: $('oauth-url').value.trim(),
    vpsUrl: $('vps-url').value.trim(),
    vpsPassword: $('vps-password').value,
    runCount: Number($('run-count').value || 1),
    pollIntervalSec: Number($('poll-interval').value || 3),
    pollTimeoutSec: Number($('poll-timeout').value || 60),
    mailKeyword: latestState?.mailKeyword || '',
    mailFromKeyword: latestState?.mailFromKeyword || '',
    mailProvider: provider,
    accountPoolText: $('account-pool-text').value,
  };
}

function updateProviderUI(provider) {
  const isAppleEmail = provider === 'appleemail';
  document.querySelectorAll('.outlook-only').forEach((el) => {
    el.style.display = isAppleEmail ? 'none' : '';
  });
  document.querySelectorAll('.appleemail-only').forEach((el) => {
    el.style.display = isAppleEmail ? '' : 'none';
  });
  const providerSelect = $('mail-provider');
  if (providerSelect) {
    providerSelect.value = provider;
  }
}

function updateAccountPoolCount() {
  const textarea = $('account-pool-text');
  const countEl = $('account-pool-count');
  if (!textarea || !countEl) return;
  const lines = textarea.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  countEl.textContent = `${lines.length} 个账号`;
}

async function refreshState() {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  try {
    const state = await call('GET_STATE');
    renderState(state);
  } catch (error) {
    showToast(`刷新状态失败：${error.message}`, 'error', 3200);
  } finally {
    refreshInFlight = false;
  }
}

async function persistForm({ silent = false } = {}) {
  const button = elements.saveButton;
  setButtonBusy(button, true, '保存中...');
  updateSaveUI();

  try {
    const state = await call('SAVE_SETTINGS', collectSettings());
    formDirty = false;
    renderState(state);
    if (!silent) {
      showToast('设置已保存', 'success');
    }
    flashButton(button, 'is-success');
    return state;
  } catch (error) {
    flashButton(button, 'is-error');
    showToast(`保存失败：${error.message}`, 'error', 3200);
    throw error;
  } finally {
    setButtonBusy(button, false);
    updateSaveUI();
  }
}

async function runAction(type, payload, options = {}) {
  const {
    buttonId,
    saveFirst = false,
    successMessage = '操作已执行',
    loadingText = '执行中...',
  } = options;

  const button = buttonId ? getButton(buttonId) : null;

  try {
    if (button) {
      setButtonBusy(button, true, loadingText);
    }
    if (saveFirst && formDirty) {
      await persistForm({ silent: true });
    }
    const data = await call(type, payload);
    await refreshState();
    if (successMessage) {
      showToast(successMessage, 'success');
    }
    if (button) {
      flashButton(button, 'is-success');
    }
    return data;
  } catch (error) {
    if (button) {
      flashButton(button, 'is-error');
    }
    showToast(error.message, 'error', 3200);
    throw error;
  } finally {
    if (button) {
      setButtonBusy(button, false);
      updateActionAvailability(latestState);
    }
  }
}

async function runStep1FetchAndOpen() {
  const button = getButton('step-1');

  try {
    if (button) {
      setButtonBusy(button, true, '执行中...');
    }
    if (formDirty) {
      await persistForm({ silent: true });
    }

    await call('GET_OAUTH_FROM_VPS');
    await call('OPEN_OAUTH_URL');
    await refreshState();
    showToast('步骤 1 已完成，OAuth 页面已打开', 'success');

    if (button) {
      flashButton(button, 'is-success');
    }
  } catch (error) {
    if (button) {
      flashButton(button, 'is-error');
    }
    showToast(error.message, 'error', 3200);
    throw error;
  } finally {
    if (button) {
      setButtonBusy(button, false);
      updateActionAvailability(latestState);
    }
  }
}

async function triggerAutoRunCommand(type, {
  saveFirst = false,
  launchMessage = '',
} = {}) {
  if (saveFirst && formDirty) {
    await persistForm({ silent: true });
  }

  chrome.runtime.sendMessage({ type, payload: null }).catch((error) => {
    showToast(error?.message || String(error), 'error', 3200);
  });

  await refreshState();
  if (launchMessage) {
    showToast(launchMessage, 'success');
  }
}

async function triggerControlCommand(type, button, {
  saveFirst = false,
  loadingText = '处理中...',
  launchMessage = '',
} = {}) {
  setButtonBusy(button, true, loadingText);
  return triggerAutoRunCommand(type, {
    saveFirst,
    launchMessage,
  }).finally(() => {
    setButtonBusy(button, false);
    updateActionAvailability(latestState);
  });
}

function updateActionAvailability(state = latestState) {
  const locked = Boolean(state?.autoRunning || state?.autoPaused);
  actionButtonIds.forEach((id) => {
    const button = getButton(id);
    if (!button || isButtonBusy(button)) return;
    if (id === 'save-settings') {
      return;
    }
    if (['auto-run-current', 'restart-current-run', 'restart-next-account'].includes(id)) {
      button.disabled = false;
      return;
    }
    button.disabled = locked;
  });
  updateSaveUI();
  updateAutoRunButton(state);
  renderAccountPicker(state);
}

async function refreshAccountSearchResults({ silent = false } = {}) {
  if (!elements.accountSearchInput) {
    return;
  }

  const requestId = ++accountSearchRequestId;
  accountSearchLoading = true;
  renderAccountPicker(latestState);

  try {
    const data = await call('LIST_AVAILABLE_ACCOUNTS', {
      query: elements.accountSearchInput.value.trim(),
    });
    if (requestId !== accountSearchRequestId) {
      return;
    }
    accountSearchResults = Array.isArray(data?.accounts) ? data.accounts : [];
    accountSearchTempEmailStatus = data?.tempEmailStatus || null;
  } catch (error) {
    if (requestId !== accountSearchRequestId) {
      return;
    }
    accountSearchResults = [];
    accountSearchTempEmailStatus = null;
    if (!silent) {
      showToast(`邮箱搜索失败：${error.message}`, 'error', 3200);
    }
  } finally {
    if (requestId === accountSearchRequestId) {
      accountSearchLoading = false;
      renderAccountPicker(latestState);
    }
  }
}

function scheduleAccountSearchRefresh() {
  clearTimeout(accountSearchDebounceTimer);
  accountSearchDebounceTimer = setTimeout(() => {
    refreshAccountSearchResults({ silent: true }).catch(() => {});
  }, 180);
}

async function selectAccount(address, button) {
  if (!address) {
    return;
  }

  try {
    if (button) {
      setButtonBusy(button, true, '选择中...');
    }
    await call('SELECT_ACCOUNT', { address });
    await refreshState();
    await refreshAccountSearchResults({ silent: true });
    showToast(`已指定邮箱：${address}`, 'success');
    if (button) {
      flashButton(button, 'is-success');
    }
  } catch (error) {
    if (button) {
      flashButton(button, 'is-error');
    }
    showToast(error.message, 'error', 3200);
  } finally {
    if (button) {
      setButtonBusy(button, false);
    }
    renderAccountPicker(latestState);
  }
}

async function clearSelectedAccount() {
  const button = elements.clearSelectedAccountButton;
  try {
    setButtonBusy(button, true, '清除中...');
    await call('SELECT_ACCOUNT', { address: '' });
    await refreshState();
    await refreshAccountSearchResults({ silent: true });
    showToast('已清除指定邮箱，将改用第一个可用邮箱', 'success');
    flashButton(button, 'is-success');
  } catch (error) {
    flashButton(button, 'is-error');
    showToast(error.message, 'error', 3200);
  } finally {
    setButtonBusy(button, false);
    renderAccountPicker(latestState);
  }
}

function bindAction(id, type, options) {
  const button = getButton(id);
  if (!button) return;
  button.addEventListener('click', () => {
    const payload = typeof options?.payload === 'function'
      ? options.payload()
      : (options?.payload ?? null);
    runAction(type, payload, {
      ...options,
      buttonId: id,
    }).catch(() => {});
  });
}

function startRefreshLoop() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    refreshState().catch(() => {});
  }, 1000);
}

formIds.forEach((id) => {
  const element = $(id);
  if (!element) return;
  const eventName = element.type === 'checkbox' ? 'change' : 'input';
  element.addEventListener(eventName, markDirty);
});

$('mail-provider')?.addEventListener('change', () => {
  const provider = $('mail-provider').value;
  updateProviderUI(provider);
  markDirty();
});

$('account-pool-text')?.addEventListener('input', () => {
  updateAccountPoolCount();
  markDirty();
});

elements.saveButton.addEventListener('click', () => {
  persistForm().catch(() => {});
});

elements.autoRunButton?.addEventListener('click', async () => {
  const state = latestState || await call('GET_STATE');
  const primaryControl = getAutoRunPrimaryControl(state);

  if (primaryControl.action === 'pause') {
    runAction('PAUSE_AUTO_RUN', null, {
      buttonId: 'auto-run-current',
      successMessage: '已请求暂停自动流程',
      loadingText: '暂停中...',
    }).catch(() => {});
    return;
  }

  if (primaryControl.action === 'continue') {
    const failedStep = getFirstStepByStatus('failed', state);
    setButtonBusy(elements.autoRunButton, true, '继续中...');
    triggerAutoRunCommand(failedStep ? 'CONTINUE_AUTO_RUN' : 'RESUME_AUTO_RUN', {
      saveFirst: true,
      launchMessage: '自动流程已继续',
    }).catch(() => {})
      .finally(() => {
        setButtonBusy(elements.autoRunButton, false);
        updateActionAvailability(latestState);
      });
    return;
  }

  setButtonBusy(elements.autoRunButton, true, '启动中...');
  triggerAutoRunCommand('AUTO_RUN_CURRENT', {
    saveFirst: true,
    launchMessage: '自动流程已启动',
  }).catch(() => {})
    .finally(() => {
      setButtonBusy(elements.autoRunButton, false);
      updateActionAvailability(latestState);
    });
});

elements.restartCurrentButton?.addEventListener('click', () => {
  triggerControlCommand('RESTART_CURRENT_RUN', elements.restartCurrentButton, {
    saveFirst: true,
    loadingText: '重启中...',
    launchMessage: '已处理重新开始请求',
  }).catch(() => {});
});

elements.restartNextButton?.addEventListener('click', () => {
  triggerControlCommand('RESTART_WITH_NEXT_ACCOUNT', elements.restartNextButton, {
    saveFirst: true,
    loadingText: '切换中...',
    launchMessage: '已处理下一个账号请求',
  }).catch(() => {});
});

elements.accountSearchInput?.addEventListener('input', () => {
  scheduleAccountSearchRefresh();
});

elements.accountSearchResults?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-account-address]');
  if (!(button instanceof HTMLButtonElement) || isButtonBusy(button)) {
    return;
  }
  selectAccount(button.dataset.accountAddress || '', button).catch(() => {});
});

elements.clearSelectedAccountButton?.addEventListener('click', () => {
  if (isButtonBusy(elements.clearSelectedAccountButton)) {
    return;
  }
  clearSelectedAccount().catch(() => {});
});

getButton('step-1')?.addEventListener('click', () => {
  const button = getButton('step-1');
  if (isButtonBusy(button)) {
    return;
  }
  runStep1FetchAndOpen().catch(() => {});
});

bindAction('step-2', 'EXECUTE_SIGNUP_STEP', {
  payload: { step: 2 },
  saveFirst: true,
  successMessage: '步骤 2 已完成',
  loadingText: '执行中...',
});

bindAction('step-3', 'EXECUTE_SIGNUP_STEP', {
  payload: { step: 3 },
  saveFirst: true,
  successMessage: '步骤 3 已完成',
  loadingText: '执行中...',
});

bindAction('poll-signup-code', 'POLL_VERIFICATION_CODE', {
  payload: { phase: 'signup' },
  saveFirst: true,
  successMessage: '注册码已获取',
  loadingText: '取码中...',
});

bindAction('fill-signup-code', 'FILL_LAST_CODE', {
  payload: { phase: 'signup' },
  saveFirst: true,
  successMessage: '注册码已回填',
  loadingText: '回填中...',
});

bindAction('step-5', 'EXECUTE_SIGNUP_STEP', {
  payload: { step: 5 },
  saveFirst: true,
  successMessage: '步骤 5 已完成',
  loadingText: '执行中...',
});

bindAction('step-6', 'EXECUTE_SIGNUP_STEP', {
  payload: { step: 6 },
  saveFirst: true,
  successMessage: '步骤 6 已完成',
  loadingText: '执行中...',
});

bindAction('poll-login-code', 'POLL_VERIFICATION_CODE', {
  payload: { phase: 'login' },
  saveFirst: true,
  successMessage: '登录码已获取',
  loadingText: '取码中...',
});

bindAction('fill-login-code', 'FILL_LAST_CODE', {
  payload: { phase: 'login' },
  saveFirst: true,
  successMessage: '登录码已回填',
  loadingText: '回填中...',
});

bindAction('step-8', 'EXECUTE_SIGNUP_STEP', {
  payload: { step: 8 },
  saveFirst: true,
  successMessage: '步骤 8 已完成',
  loadingText: '执行中...',
});

bindAction('step-9', 'EXECUTE_FINAL_VERIFY_STEP', {
  saveFirst: true,
  successMessage: '步骤 9 已完成',
  loadingText: '执行中...',
});

bindAction('complete-flow', 'COMPLETE_CURRENT_ACCOUNT', {
  saveFirst: true,
  successMessage: '当前流程已完成并已标记',
  loadingText: '提交中...',
});

elements.copyLogsButton?.addEventListener('click', async () => {
  const button = elements.copyLogsButton;
  const text = buildPlainLogs();
  if (!text) {
    showToast('当前没有可复制的日志', 'warn');
    return;
  }

  try {
    setButtonBusy(button, true, '复制中...');
    await copyText(text);
    showToast('日志已复制', 'success');
    flashButton(button, 'is-success');
  } catch (error) {
    flashButton(button, 'is-error');
    showToast(`复制失败：${error.message}`, 'error', 3200);
  } finally {
    setButtonBusy(button, false);
  }
});

elements.clearLogsButton?.addEventListener('click', () => {
  runAction('CLEAR_LOGS', null, {
    buttonId: 'clear-logs',
    successMessage: '日志已清空',
    loadingText: '清空中...',
  }).catch(() => {});
});

elements.toggleApiKeyButton?.addEventListener('click', () => {
  toggleSecretInput('api-key', elements.toggleApiKeyButton, '隐藏 API Key', '显示 API Key');
});

elements.toggleDefaultLoginPasswordButton?.addEventListener('click', () => {
  toggleSecretInput('default-login-password', elements.toggleDefaultLoginPasswordButton, '隐藏默认登录密码', '显示默认登录密码');
});

elements.toggleVpsPasswordButton?.addEventListener('click', () => {
  toggleSecretInput('vps-password', elements.toggleVpsPasswordButton, '隐藏管理密钥', '显示管理密钥');
});

refreshState().catch(() => {});
refreshAccountSearchResults({ silent: true }).catch(() => {});
startRefreshLoop();
