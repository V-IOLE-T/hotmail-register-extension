const utils = globalThis.HotmailRegisterUtils;
const oauthHelpers = globalThis.HotmailRegisterOAuthHelpers || {};
const step9StatusHelpers = globalThis.HotmailRegisterStep9Status || {};

const STEP9_EXISTING_SUCCESS_WAIT_MS = 1500;
const STEP9_STATUS_TIMEOUT_MS = 18000;
const STEP9_PENDING_CONFLICT_GRACE_MS = 4000;

function isVisibleElement(element) {
  return utils.isVisible(element);
}

function getActionText(element) {
  return [
    element?.textContent,
    element?.value,
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStatusBadgeText() {
  const statusElement = document.querySelector('.status-badge, [class*="status-badge"]');
  return statusElement ? (statusElement.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

function collectStep9StatusTexts() {
  const texts = [];
  const directBadgeText = getStatusBadgeText();
  if (directBadgeText) texts.push(directBadgeText);

  document.querySelectorAll('.status-badge, [class*="status"], .card, .card *, main, main *').forEach((element) => {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) texts.push(text);
  });

  return Array.from(new Set(texts));
}

async function waitForStep9SuccessStatus(timeout = STEP9_STATUS_TIMEOUT_MS) {
  const startedAt = Date.now();
  let pendingConflictSeenAt = 0;

  while (Date.now() - startedAt < timeout) {
    utils.throwIfStopped();
    const statusTexts = collectStep9StatusTexts();
    const outcome = (step9StatusHelpers.getStep9StatusOutcome || (() => ({ kind: 'waiting', text: '' })))({
      texts: statusTexts,
      now: Date.now(),
      pendingConflictSeenAt,
      pendingConflictGraceMs: STEP9_PENDING_CONFLICT_GRACE_MS,
    });
    if (outcome.kind === 'success') {
      return outcome.text;
    }
    if (outcome.kind === 'oauth_timeout') {
      throw new Error(`STEP9_OAUTH_TIMEOUT::${outcome.text}`);
    }
    if (outcome.kind === 'pending_conflict_wait') {
      if (!pendingConflictSeenAt) {
        pendingConflictSeenAt = Date.now();
        utils.log('步骤 9：CPA 暂时提示 oauth flow is not pending，先继续等待成功状态同步...', 'warn');
      }
      await utils.sleep(200);
      continue;
    }
    if (outcome.kind === 'pending_conflict_timeout') {
      throw new Error(`回调 URL 提交失败：${outcome.text}`);
    }

    await utils.sleep(200);
  }

  throw new Error(getStatusBadgeText() || 'CPA 面板长时间未出现认证结果。');
}

async function waitForExistingStep9Success(timeout = STEP9_EXISTING_SUCCESS_WAIT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const statusTexts = collectStep9StatusTexts();
    const successText = oauthHelpers.findStep9SuccessText?.(statusTexts);
    if (successText) {
      return successText;
    }
    await utils.sleep(250);
  }
  return '';
}

function findCallbackUrlInput() {
  const selectors = [
    '[class*="callbackSection"] input.input',
    'input[placeholder*="localhost"]',
  ];

  for (const selector of selectors) {
    const candidates = document.querySelectorAll(selector);
    const visible = Array.from(candidates).find(isVisibleElement);
    if (visible) return visible;
  }

  return null;
}

function findCallbackSubmitButton() {
  const candidates = document.querySelectorAll(
    '[class*="callbackActions"] button, [class*="callbackSection"] button, button.btn'
  );

  return Array.from(candidates).find((element) => isVisibleElement(element) && /提交|submit/i.test(getActionText(element))) || null;
}

function findManagementKeyInput() {
  const candidates = document.querySelectorAll(
    '.LoginPage-module__loginCard___OgP-R input[type="password"], input[placeholder*="管理密钥"], input[aria-label*="管理密钥"]'
  );
  return Array.from(candidates).find(isVisibleElement) || null;
}

function findManagementLoginButton() {
  const candidates = document.querySelectorAll('.LoginPage-module__loginCard___OgP-R button, .LoginPage-module__loginCard___OgP-R .btn');
  return Array.from(candidates).find((element) => isVisibleElement(element) && /登录|login/i.test(getActionText(element))) || null;
}

function findRememberPasswordCheckbox() {
  const candidates = document.querySelectorAll('.LoginPage-module__loginCard___OgP-R input[type="checkbox"]');
  return Array.from(candidates).find((element) => {
    const label = element.closest('label');
    return /记住密码|remember/i.test(getActionText(label || element));
  }) || null;
}

function findOAuthNavLink() {
  const candidates = document.querySelectorAll('a[href*="#/oauth"], a.nav-item, button, [role="link"], [role="button"]');
  return Array.from(candidates).find((element) => {
    if (!isVisibleElement(element)) return false;
    const text = getActionText(element);
    const href = element.getAttribute('href') || '';
    return href.includes('#/oauth') || /oauth/i.test(text);
  }) || null;
}

function findCodexOAuthHeader() {
  const candidates = document.querySelectorAll('.card-header, [class*="cardHeader"], .card, [class*="card"]');
  return Array.from(candidates).find((element) => {
    if (!isVisibleElement(element)) return false;
    const text = (element.textContent || '').toLowerCase();
    return text.includes('codex') && text.includes('oauth');
  }) || null;
}

function findOAuthCardLoginButton(header) {
  const card = header?.closest('.card, [class*="card"]') || header?.parentElement || document;
  const candidates = card.querySelectorAll('button.btn.btn-primary, button.btn-primary, button.btn');
  return Array.from(candidates).find((element) => isVisibleElement(element) && /登录|login/i.test(getActionText(element))) || null;
}

function findAuthUrlElement() {
  const candidates = document.querySelectorAll('[class*="authUrlValue"], .OAuthPage-module__authUrlValue___axvUJ');
  return Array.from(candidates).find((element) => isVisibleElement(element) && /^https?:\/\//i.test((element.textContent || '').trim())) || null;
}

async function ensureOAuthManagementPage(vpsPassword, step = 1, timeout = 45000) {
  const startedAt = Date.now();
  let lastLoginAttemptAt = 0;
  let lastOauthNavAttemptAt = 0;

  while (Date.now() - startedAt < timeout) {
    utils.throwIfStopped();

    if (step === 9 && findCallbackUrlInput()) {
      return { header: findCodexOAuthHeader(), authUrlEl: findAuthUrlElement() };
    }

    const authUrlElement = findAuthUrlElement();
    if (authUrlElement) {
      return { header: findCodexOAuthHeader(), authUrlEl: authUrlElement };
    }

    const oauthHeader = findCodexOAuthHeader();
    if (oauthHeader) {
      return { header: oauthHeader, authUrlEl: null };
    }

    const managementKeyInput = findManagementKeyInput();
    const managementLoginButton = findManagementLoginButton();
    if (managementKeyInput && managementLoginButton) {
      if (!vpsPassword) {
        throw new Error('CPA 面板需要管理密钥，请先在侧边栏填写 CPA Key（管理密钥）。');
      }

      if ((managementKeyInput.value || '') !== vpsPassword) {
        await utils.humanPause(350, 900);
        utils.fillInput(managementKeyInput, vpsPassword);
        utils.log(`步骤 ${step}：已填写 CPA 管理密钥。`);
      }

      const rememberCheckbox = findRememberPasswordCheckbox();
      if (rememberCheckbox && !rememberCheckbox.checked) {
        utils.simulateClick(rememberCheckbox);
        utils.log(`步骤 ${step}：已勾选 CPA 面板“记住密码”。`);
        await utils.sleep(300);
      }

      if (Date.now() - lastLoginAttemptAt > 3000) {
        lastLoginAttemptAt = Date.now();
        await utils.humanPause(350, 900);
        utils.simulateClick(managementLoginButton);
        utils.log(`步骤 ${step}：已提交 CPA 管理登录。`);
      }

      await utils.sleep(1500);
      continue;
    }

    const oauthNavLink = findOAuthNavLink();
    if (oauthNavLink && Date.now() - lastOauthNavAttemptAt > 2000) {
      lastOauthNavAttemptAt = Date.now();
      await utils.humanPause(300, 800);
      utils.simulateClick(oauthNavLink);
      utils.log(`步骤 ${step}：已打开“OAuth 登录”导航。`);
      await utils.sleep(1200);
      continue;
    }

    await utils.sleep(250);
  }

  throw new Error(`无法进入 CPA 的 OAuth 管理页面。URL: ${location.href}`);
}

async function step1GetOAuthLink(payload) {
  const { vpsPassword } = payload || {};
  utils.log('步骤 1：正在等待 CPA 面板加载并进入 OAuth 页面...');
  const { header, authUrlEl: existingAuthUrlEl } = await ensureOAuthManagementPage(vpsPassword, 1);
  let authUrlEl = existingAuthUrlEl;

  if (!authUrlEl) {
    const loginButton = findOAuthCardLoginButton(header);
    if (!loginButton) {
      throw new Error(`已找到 Codex OAuth 卡片，但卡片内没有登录按钮。URL: ${location.href}`);
    }

    if (loginButton.disabled) {
      utils.log('步骤 1：OAuth 登录按钮当前不可用，正在等待授权链接出现...');
    } else {
      await utils.humanPause(500, 1400);
      utils.simulateClick(loginButton);
      utils.log('步骤 1：已点击 OAuth 登录按钮，正在等待授权链接...');
    }

    authUrlEl = await utils.waitForElement('[class*="authUrlValue"]', 15000);
  } else {
    utils.log('步骤 1：CPA 面板上已显示授权链接。');
  }

  const oauthUrl = (authUrlEl.textContent || '').trim();
  if (!oauthUrl || !oauthUrl.startsWith('http')) {
    throw new Error(`拿到的 OAuth 链接无效：${oauthUrl.slice(0, 50)}`);
  }

  utils.log(`步骤 1：已获取 OAuth 链接：${oauthUrl.slice(0, 80)}...`, 'ok');
  utils.reportComplete(1, { oauthUrl });
  return { oauthUrl };
}

async function step9Verify(payload) {
  await ensureOAuthManagementPage(payload?.vpsPassword, 9);

  let localhostUrl = payload?.localhostUrl;
  if (!localhostUrl) {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    localhostUrl = state?.data?.localhostUrl || state?.localhostUrl;
  }
  if (!localhostUrl) {
    throw new Error('未找到 localhost 回调地址，请先完成步骤 8。');
  }

  let urlInput = findCallbackUrlInput();
  if (!urlInput) {
    urlInput = await utils.waitForElement('[class*="callbackSection"] input.input, input[placeholder*="localhost"]', 10000);
  }

  const existingSuccessText = oauthHelpers.findStep9SuccessText?.(collectStep9StatusTexts());
  if (existingSuccessText) {
    utils.log(`步骤 9：提交前已识别 CPA 成功状态：${existingSuccessText}`, 'ok');
    utils.reportComplete(9, { localhostUrl, verifiedStatus: existingSuccessText });
    return { localhostUrl, verifiedStatus: existingSuccessText };
  }

  utils.log('步骤 9：正在等待 CPA 面板同步 OAuth 结果，若已成功则跳过回调提交...');
  const successDuringGrace = await waitForExistingStep9Success();
  if (successDuringGrace) {
    utils.log(`步骤 9：短暂等待后已识别 CPA 成功状态：${successDuringGrace}`, 'ok');
    utils.reportComplete(9, { localhostUrl, verifiedStatus: successDuringGrace });
    return { localhostUrl, verifiedStatus: successDuringGrace };
  }

  await utils.humanPause(600, 1500);
  utils.fillInput(urlInput, localhostUrl);

  let submitButton = findCallbackSubmitButton();
  if (!submitButton) {
    submitButton = await utils.waitForElementByText(
      '[class*="callbackActions"] button, [class*="callbackSection"] button, button.btn',
      /提交|submit/i,
      5000
    );
  }

  await utils.humanPause(450, 1200);
  utils.simulateClick(submitButton);
  utils.log('步骤 9：已提交回调 URL，正在等待 CPA 面板确认结果...');
  const verifiedStatus = await waitForStep9SuccessStatus();
  utils.log(`步骤 9：已识别 CPA 成功状态：${verifiedStatus}`, 'ok');
  utils.reportComplete(9, { localhostUrl, verifiedStatus });
  return { localhostUrl, verifiedStatus };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'EXECUTE_STEP') return;

  const tasks = {
    1: () => step1GetOAuthLink(message.payload || {}),
    9: () => step9Verify(message.payload || {}),
  };

  const task = tasks[message.step];
  if (!task) return;

  utils.resetStopState();
  task()
    .then((data) => sendResponse({ ok: true, ...(data || {}) }))
    .catch((error) => {
      utils.reportError(message.step, error.message || String(error));
      sendResponse({ ok: false, error: error.message || String(error) });
    });

  return true;
});
