const utils = globalThis.HotmailRegisterUtils;
const helpers = globalThis.HotmailRegisterHelpers;
const PENDING_SIGNUP_STEP_KEY = '__hotmail_register_pending_signup_step__';

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

function isActionEnabled(element) {
  return Boolean(element)
    && !element.disabled
    && element.getAttribute('aria-disabled') !== 'true';
}

function getPageTextSnapshot() {
  return (document.body?.innerText || document.body?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ONE_TIME_CODE_LOGIN_PATTERN = /使用一次性验证码登录|改用(?:一次性)?验证码(?:登录)?|使用验证码登录|一次性验证码|验证码登录|one[-\s]*time\s*(?:passcode|password|code)|use\s+(?:a\s+)?one[-\s]*time\s*(?:passcode|password|code)(?:\s+instead)?|use\s+(?:a\s+)?code(?:\s+instead)?|sign\s+in\s+with\s+(?:email|code)|email\s+(?:me\s+)?(?:a\s+)?code/i;
const VERIFICATION_PAGE_PATTERN = /检查您的收件箱|输入我们刚刚向|重新发送电子邮件|重新发送验证码|验证码|代码不正确|email\s+verification/i;
const ADD_PHONE_PAGE_PATTERN = /add[\s-]*phone|添加手机号|手机号码|手机号|phone\s+number|telephone/i;
const OAUTH_CONSENT_PAGE_PATTERN = /使用\s*ChatGPT\s*登录到|login\s+to|log\s+in\s+to|authorize|授权/i;
const SIGNUP_PASSWORD_RULE_PATTERN = /at\s+least\s+12\s+characters|your\s+password\s+must\s+contain|password\s+must\s+contain|至少\s*12\s*个字符|密码必须包含/i;
const STEP5_SUBMIT_ERROR_PATTERN = /无法根据该信息创建帐户|请重试|unable\s+to\s+create\s+(?:your\s+)?account|couldn'?t\s+create\s+(?:your\s+)?account|something\s+went\s+wrong|invalid\s+(?:birthday|birth|date)|生日|出生日期|年龄|age/i;
const LOGIN_ACTION_PATTERN = /log\s*in|login|sign\s*in|已有账号.*登录|去登录|立即登录/i;

function findOneTimeCodeLoginTrigger() {
  const candidates = document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  );

  return Array.from(candidates).find((element) => {
    if (!isVisibleElement(element)) return false;
    if (!isActionEnabled(element)) return false;
    return ONE_TIME_CODE_LOGIN_PATTERN.test(getActionText(element));
  }) || null;
}

function findResendTrigger() {
  const candidates = document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  );

  return Array.from(candidates).find((element) => {
    if (!isVisibleElement(element)) return false;
    return /重新发送|重发|resend|send\s+(?:a\s+)?new\s+code|didn'?t\s+receive/i.test(getActionText(element));
  }) || null;
}

function findResendVerificationCodeTrigger({ allowDisabled = false } = {}) {
  const trigger = findResendTrigger();
  if (!trigger) return null;
  if (!allowDisabled && !isActionEnabled(trigger)) {
    return null;
  }
  return trigger;
}

function isVerificationPageStillVisible() {
  if (helpers.getCodeInput()) return true;
  if (findResendTrigger()) return true;
  return VERIFICATION_PAGE_PATTERN.test(getPageTextSnapshot());
}

function isLoginVerificationStageReady() {
  return Boolean(
    helpers.getCodeInput()
    || findResendTrigger()
    || helpers.isEmailVerificationUrl?.(location.href)
  );
}

function isAddPhonePageReady() {
  const phoneInput = document.querySelector(
    'input[type="tel"]:not([maxlength="6"]), input[name*="phone" i], input[id*="phone" i], input[autocomplete="tel"]'
  );
  if (phoneInput && isVisibleElement(phoneInput)) {
    return true;
  }
  return ADD_PHONE_PAGE_PATTERN.test(getPageTextSnapshot());
}

function isProfileSetupPageReady() {
  const selectors = [
    'input[name="name"]',
    'input[placeholder*="全名"]',
    'input[autocomplete="name"]',
    'input[name="birthday"]',
    'input[name="age"]',
    '[role="spinbutton"][data-type="year"]',
  ];

  const visibleField = selectors.some((selector) => {
    const element = document.querySelector(selector);
    return element && isVisibleElement(element);
  });

  return visibleField || helpers.isProfileSetupPageText(getPageTextSnapshot());
}

function getSignupPasswordValidationErrorText() {
  const messages = [];
  const selectors = [
    '.react-aria-FieldError',
    '[slot="errorMessage"]',
    '[id$="-error"]',
    '[role="alert"]',
    '[aria-live="assertive"]',
    '[aria-live="polite"]',
    '[class*="error"]',
  ];

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((element) => {
      if (!isVisibleElement(element)) return;
      const text = helpers.normalizeInlineText?.(element.textContent || '') || '';
      if (text && helpers.isSignupPasswordValidationErrorText?.(text)) {
        messages.push(text);
      }
    });
  }

  const invalidPasswordInput = Array.from(document.querySelectorAll('input[type="password"][aria-invalid="true"], input[name="password"][aria-invalid="true"], input[type="password"][data-invalid="true"]'))
    .find((element) => isVisibleElement(element));
  if (invalidPasswordInput) {
    const wrapper = invalidPasswordInput.closest('form, fieldset, [data-rac], div');
    const wrapperText = helpers.normalizeInlineText?.(wrapper?.textContent || '') || '';
    if (wrapperText && helpers.isSignupPasswordValidationErrorText?.(wrapperText)) {
      messages.push(wrapperText);
    }
  }

  return messages[0] || '';
}

function getStep5ErrorText() {
  const messages = [];
  const selectors = [
    '.react-aria-FieldError',
    '[slot="errorMessage"]',
    '[id$="-error"]',
    '[id$="-errors"]',
    '[role="alert"]',
    '[aria-live="assertive"]',
    '[aria-live="polite"]',
    '[class*="error"]',
  ];

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((element) => {
      if (!isVisibleElement(element)) return;
      const text = helpers.normalizeInlineText?.(element.textContent || '') || getActionText(element);
      if (text) {
        messages.push(text);
      }
    });
  }

  return messages.find((text) => STEP5_SUBMIT_ERROR_PATTERN.test(text)) || '';
}

async function waitForStep5SubmitOutcome(timeout = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const errorText = getStep5ErrorText();
    if (errorText) {
      return { invalidProfile: true, errorText };
    }

    if (isAddPhonePageReady()) {
      return { success: true, addPhonePage: true };
    }

    if (isStep8Ready()) {
      return { success: true };
    }

    await utils.sleep(150);
  }

  const errorText = getStep5ErrorText();
  if (errorText) {
    return { invalidProfile: true, errorText };
  }

  return {
    invalidProfile: true,
    errorText: '提交资料后未进入下一阶段，请检查页面是否仍停留在 about-you / 年龄资料页。',
  };
}

function readPendingSignupStep() {
  try {
    const raw = sessionStorage.getItem(PENDING_SIGNUP_STEP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePendingSignupStep(payload) {
  sessionStorage.setItem(PENDING_SIGNUP_STEP_KEY, JSON.stringify(payload));
}

function clearPendingSignupStep() {
  sessionStorage.removeItem(PENDING_SIGNUP_STEP_KEY);
}

function isSignupLandingPageReady() {
  const pageText = getPageTextSnapshot();
  if (!helpers.isSignupLandingPageText(pageText) || helpers.isLoginPasswordPageText(pageText)) {
    return false;
  }

  // 明确是登录页 URL → 不是注册落地页
  if (helpers.isLoginFlowUrl?.(location.href)) {
    return false;
  }

  const headingCandidates = Array.from(document.querySelectorAll('h1, h2, [role="heading"]'))
    .filter(isVisibleElement)
    .map(getActionText);
  const hasCreateAccountHeading = headingCandidates.some((text) => /create\s+an\s+account|创建(?:帐户|账户|账号)/i.test(text));
  const emailInput = helpers.getEmailInput();

  return Boolean(emailInput && isVisibleElement(emailInput))
    && (helpers.isSignupFlowUrl?.(location.href) || hasCreateAccountHeading);
}

function isSignupIdentifierPageReady() {
  const emailInput = helpers.getEmailInput();
  if (!emailInput || !isVisibleElement(emailInput)) {
    return false;
  }

  // 明确是登录页 URL → 不是注册页
  if (helpers.isLoginFlowUrl?.(location.href)) {
    return false;
  }

  const pageText = getPageTextSnapshot();
  if (helpers.isLoginPasswordPageText(pageText)) {
    return false;
  }

  const headingCandidates = Array.from(document.querySelectorAll('h1, h2, [role="heading"]'))
    .filter(isVisibleElement)
    .map(getActionText);
  const hasSignupHeading = headingCandidates.some((text) => /create\s+an\s+account|sign\s*up|创建(?:帐户|账户|账号)|注册/i.test(text));

  return Boolean(
    helpers.isSignupFlowUrl?.(location.href)
    || hasSignupHeading
    || helpers.isSignupLandingPageText(pageText)
  );
}

function isSignupPasswordCreationPageReady() {
  const pageText = getPageTextSnapshot();
  const passwordInput = helpers.getPasswordInput();
  return Boolean(
    passwordInput
    && isVisibleElement(passwordInput)
    && (helpers.isSignupFlowUrl?.(location.href) || helpers.isSignupPageText(pageText))
    && !helpers.isLoginPasswordPageText(pageText)
  );
}

function isLoginFlowPageReady() {
  const pageText = getPageTextSnapshot();
  return Boolean(
    helpers.isLoginFlowUrl?.(location.href)
    || helpers.isLoginPasswordPageText(pageText)
  );
}

function findLoginAction() {
  const candidates = document.querySelectorAll(
    'a[href*="login"], a[href*="log-in"], button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  );

  return Array.from(candidates).find((element) => {
    if (!isVisibleElement(element)) return false;
    if (!isActionEnabled(element)) return false;
    const actionText = getActionText(element);
    if (!LOGIN_ACTION_PATTERN.test(actionText)) return false;
    return !helpers.isSignupActionText(actionText);
  }) || null;
}

async function switchStep3ToLoginFlow(payload, source = 'direct') {
  clearPendingSignupStep();
  utils.log(
    source === 'existing_account'
      ? '步骤 3：检测到当前邮箱已注册，已切换到登录流程，后续转步骤 6 处理。'
      : '步骤 3：检测到当前页面已进入登录流程，后续转步骤 6 处理。',
    'warn'
  );
  utils.reportComplete(3, { address: payload.address, switchToLoginFlow: true });
  return { ok: true, switchToLoginFlow: true };
}

async function detectExistingAccountLoginFlow(payload, timeout = 8000) {
  const pageText = getPageTextSnapshot();
  const loginAction = findLoginAction();
  const loginFlowStateSummary = helpers.describeStep3LoginFlowState?.({
    url: location.href,
    text: pageText,
    hasLoginAction: Boolean(loginAction),
  }) || `url=${location.href}`;
  const shouldSwitchToLoginFlow = helpers.shouldTreatLoginFlowAsExistingAccount?.({
    url: location.href,
    text: pageText,
    hasLoginAction: Boolean(loginAction),
  });

  if (!shouldSwitchToLoginFlow) {
    if (helpers.isLoginFlowUrl?.(location.href) || helpers.isLoginPasswordPageText(pageText) || loginAction) {
      utils.log(`步骤 3：检测到登录流迹象，但未命中“邮箱已存在”信号，暂不判定为已注册。${loginFlowStateSummary}`, 'warn');
    }
    return null;
  }

  utils.log(`步骤 3：命中“邮箱已存在”信号，准备切换登录流程。${loginFlowStateSummary}`, 'warn');

  if (helpers.isLoginFlowUrl?.(location.href) || helpers.isLoginPasswordPageText(pageText)) {
    return switchStep3ToLoginFlow(payload, 'existing_account');
  }

  if (!loginAction) {
    return null;
  }

  utils.log('步骤 3：检测到当前邮箱可能已注册，正在点击登录入口...', 'warn');
  utils.clickElement(loginAction);

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (isLoginFlowPageReady()) {
      return switchStep3ToLoginFlow(payload, 'existing_account');
    }
    await utils.sleep(300);
  }

  return null;
}

async function recoverSignupFlowFromLoginPage(timeout = 8000) {
  if (!helpers.isLoginFlowUrl?.(location.href) && !helpers.isLoginPasswordPageText(getPageTextSnapshot())) {
    return false;
  }

  const startedAt = Date.now();
  let clickAttempts = 0;

  while (Date.now() - startedAt < timeout) {
    if (isSignupIdentifierPageReady() || isSignupPasswordCreationPageReady()) {
      return true;
    }

    const signupAction = Array.from(document.querySelectorAll(
      'a[href*="signup"], a[href*="register"], button, a, [role="button"], [role="link"]'
    )).find((element) => {
      if (!isVisibleElement(element)) return false;
      if (!isActionEnabled(element)) return false;
      return helpers.isSignupActionText(getActionText(element));
    }) || null;

    if (signupAction && clickAttempts < 2) {
      clickAttempts += 1;
      utils.log(`步骤 3：当前停留在登录页，正在重新点击注册入口（第 ${clickAttempts} 次）...`, 'warn');
      utils.clickElement(signupAction);
    }

    await utils.sleep(1200);
  }

  return isSignupIdentifierPageReady() || isSignupPasswordCreationPageReady();
}

function isExplicitVisibleSignupFlowPageReady() {
  return isSignupLandingPageReady()
    || isSignupPasswordCreationPageReady()
    || isProfileSetupPageReady();
}

function getPrimaryContinueButton() {
  const actionCandidates = document.querySelectorAll('button, [role="button"], input[type="submit"]');
  const consentUrl = helpers.isOAuthConsentUrl(location.href);

  return Array.from(actionCandidates).find((element) => {
    if (!isVisibleElement(element)) return false;
    const actionText = getActionText(element);
    if (!helpers.isStep8ActionText(actionText)) return false;

    if (!consentUrl) {
      return /继续|continue/i.test(actionText);
    }

    return !/cancel|back|返回|取消/i.test(actionText);
  }) || null;
}

function isStep8Ready() {
  const continueButton = getPrimaryContinueButton();
  if (!continueButton) return false;
  if (isVerificationPageStillVisible()) return false;
  if (isAddPhonePageReady()) return false;

  return helpers.shouldUseStep8ContinueButton({
    hasContinueButton: true,
    hasActionButton: true,
    isVerificationPage: false,
    isAddPhonePage: false,
    isConsentUrl: helpers.isOAuthConsentUrl(location.href),
    isConsentText: OAUTH_CONSENT_PAGE_PATTERN.test(getPageTextSnapshot()),
  });
}

async function step2OpenSignup() {
  const emailInput = helpers.getEmailInput();
  const passwordInput = helpers.getPasswordInput();

  if (isExplicitVisibleSignupFlowPageReady()) {
    clearPendingSignupStep();
    utils.log('步骤 2：当前已经处于真实注册页。', 'ok');
    utils.reportComplete(2, { alreadyOnSignup: true });
    return { ok: true, alreadyOnSignup: true };
  }

  utils.log('步骤 2：正在查找注册入口...');

  const candidates = document.querySelectorAll(
    'a[href*="signup"], a[href*="register"], button[data-testid*="signup"], button, a, [role="button"], [role="link"]'
  );

  const button = Array.from(candidates).find((element) => {
    if (!isVisibleElement(element)) return false;
    const actionText = getActionText(element);
    if (!helpers.isSignupActionText(actionText)) return false;

    const href = element.getAttribute?.('href') || '';
    return /signup|register/i.test(href) || helpers.isSignupActionText(actionText);
  }) || null;

  if (button) {
    const startedAt = Date.now();
    let clickAttempts = 0;
    while (Date.now() - startedAt < 8000) {
      if (isExplicitVisibleSignupFlowPageReady()) {
        clearPendingSignupStep();
        utils.log('步骤 2：已确认进入真实注册页。', 'ok');
        utils.reportComplete(2, { enteredSignup: true });
        return { ok: true };
      }

      const currentButton = Array.from(document.querySelectorAll(
        'a[href*="signup"], a[href*="register"], button[data-testid*="signup"], button, a, [role="button"], [role="link"]'
      )).find((element) => {
        if (!isVisibleElement(element)) return false;
        if (!isActionEnabled(element)) return false;
        const actionText = getActionText(element);
        if (!helpers.isSignupActionText(actionText)) return false;
        const href = element.getAttribute?.('href') || '';
        return /signup|register/i.test(href) || helpers.isSignupActionText(actionText);
      });

      if (currentButton && clickAttempts < 3) {
        writePendingSignupStep({ step: 2, startedAt: Date.now() });
        utils.clickElement(currentButton);
        clickAttempts += 1;
        utils.log(`步骤 2：已点击注册入口，正在等待注册页加载（第 ${clickAttempts} 次）...`);
      }

      await utils.sleep(1200);
    }

    throw new Error(`已点击注册入口，但页面仍未进入真正的注册页。URL: ${location.href}`);
  }

  if ((emailInput || passwordInput) && !isExplicitVisibleSignupFlowPageReady()) {
    throw new Error(`当前仍停留在登录入口页，未找到明确的注册按钮。URL: ${location.href}`);
  }

  throw new Error(`未找到注册入口，无法进入注册流程。URL: ${location.href}`);
}

async function finishStep3OnPasswordPage(payload) {
  const passwordInput = await utils.waitForElement('input[type="password"], input[name="password"]', 15000);
  if (!isSignupPasswordCreationPageReady()) {
    if (await recoverSignupFlowFromLoginPage()) {
      if (isSignupIdentifierPageReady() && !isSignupPasswordCreationPageReady()) {
        utils.log('步骤 3：已从登录页切回注册入口页，准备重新填写邮箱...', 'warn');
        return step3FillCredentials(payload);
      }
      utils.log('步骤 3：已从登录页切回注册密码页，继续填写密码...', 'warn');
      return finishStep3OnPasswordPage(payload);
    }
    throw new Error(`当前进入了登录页，不是注册密码页。URL: ${location.href}`);
  }

  const resolvedPassword = String(payload.password || '').trim();
  if (!resolvedPassword) {
    throw new Error('步骤 3 缺少可用密码，请先设置默认登录密码或检查邮箱来源密码。');
  }
  if (resolvedPassword.length < 12) {
    throw new Error('步骤 3 使用的密码长度不足 12 位，请修改默认登录密码。');
  }

  utils.setInputValue(passwordInput, resolvedPassword);
  utils.log('步骤 3：密码已填写');

  const submitButton = helpers.queryFirst(['button[type="submit"]', 'button[name="continue"]']);
  if (submitButton) {
    writePendingSignupStep({
      step: 3,
      payload,
      phase: 'submitted',
      startedAt: Date.now(),
    });
    utils.clickElement(submitButton);
    utils.log('步骤 3：注册表单已提交，等待页面继续...');
    await utils.sleep(500);
    const passwordErrorText = getSignupPasswordValidationErrorText();
    if (isSignupPasswordCreationPageReady() && passwordErrorText) {
      clearPendingSignupStep();
      throw new Error(`步骤 3：注册密码不符合页面规则，请检查默认登录密码设置。详情：${passwordErrorText}`);
    }
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 6000) {
    if (isProfileSetupPageReady()) {
      utils.log('步骤 3：检测到当前邮箱已进入资料页，后续将直接进入步骤 5。', 'warn');
      clearPendingSignupStep();
      utils.reportComplete(3, { address: payload.address, skipSignupVerification: true });
      return { ok: true, skipSignupVerification: true };
    }
    if (helpers.getCodeInput() || isVerificationPageStillVisible() || helpers.isEmailVerificationUrl?.(location.href)) {
      clearPendingSignupStep();
      utils.reportComplete(3, { address: payload.address });
      return { ok: true };
    }
    const passwordErrorText = getSignupPasswordValidationErrorText();
    if (isSignupPasswordCreationPageReady() && passwordErrorText) {
      clearPendingSignupStep();
      throw new Error(`步骤 3：注册密码不符合页面规则，请检查默认登录密码设置。详情：${passwordErrorText}`);
    }
    await utils.sleep(200);
  }

  clearPendingSignupStep();
  throw new Error('步骤 3：提交后未进入验证码页或资料页，请检查页面是否仍停留在注册密码页。');
}

async function step3FillCredentials(payload) {
  if (helpers.isEmailVerificationUrl?.(location.href) || isVerificationPageStillVisible()) {
    clearPendingSignupStep();
    utils.log('步骤 3：页面已进入邮箱验证码阶段，本步骤按已完成处理。', 'ok');
    utils.reportComplete(3, { address: payload.address });
    return { ok: true };
  }

  if (isProfileSetupPageReady()) {
    clearPendingSignupStep();
    utils.log('步骤 3：页面已直接进入资料页，后续将跳过注册码阶段。', 'warn');
    utils.reportComplete(3, { address: payload.address, skipSignupVerification: true });
    return { ok: true, skipSignupVerification: true };
  }

  if (!isSignupIdentifierPageReady() && !isSignupPasswordCreationPageReady()) {
    throw new Error(`当前仍未进入真正的注册页。URL: ${location.href}`);
  }

  if (isSignupPasswordCreationPageReady()) {
    utils.log('步骤 3：检测到已进入注册密码页，继续填写密码...');
    return finishStep3OnPasswordPage(payload);
  }
  utils.log(`步骤 3：正在填写邮箱：${payload.address}`);
  const emailInput = await utils.waitForElement('input[type="email"], input[name="email"]');
  utils.setInputValue(emailInput, payload.address);
  utils.log('步骤 3：邮箱已填写');

  const directPasswordInput = helpers.getPasswordInput();
  if (directPasswordInput && isVisibleElement(directPasswordInput) && isSignupPasswordCreationPageReady()) {
    return finishStep3OnPasswordPage(payload);
  }

  const continueButton = helpers.queryFirst(['button[type="submit"]', 'button[name="continue"]']);
  if (continueButton) {
    writePendingSignupStep({
      step: 3,
      payload,
      startedAt: Date.now(),
    });
    utils.clickElement(continueButton);
    utils.log('步骤 3：邮箱已提交，正在等待密码输入框...');
    await utils.sleep(800);
  }

  const loginFlowResult = await detectExistingAccountLoginFlow(payload);
  if (loginFlowResult) {
    return loginFlowResult;
  }

  return finishStep3OnPasswordPage(payload);
}

async function resumePendingSignupStep() {
  const pending = readPendingSignupStep();
  if (!pending?.step) {
    return;
  }

  if (pending.step === 2) {
    if (isExplicitVisibleSignupFlowPageReady()) {
      clearPendingSignupStep();
      utils.log('步骤 2：页面切换后已确认进入真实注册页。', 'ok');
      utils.reportComplete(2, { resumed: true });
    }
    return;
  }

  if (pending.step === 3 && pending.payload) {
    if (isVerificationPageStillVisible() || helpers.isEmailVerificationUrl?.(location.href)) {
      clearPendingSignupStep();
      utils.reportComplete(3, { address: pending.payload.address });
      return;
    }
    const loginFlowResult = await detectExistingAccountLoginFlow(pending.payload);
    if (loginFlowResult) {
      return;
    }
    if (isProfileSetupPageReady()) {
      clearPendingSignupStep();
      utils.log('步骤 3：页面切换后已进入资料页，后续将直接进入步骤 5。', 'warn');
      utils.reportComplete(3, { address: pending.payload.address, skipSignupVerification: true });
      return;
    }
    const passwordErrorText = getSignupPasswordValidationErrorText();
    if (isSignupPasswordCreationPageReady() && passwordErrorText) {
      clearPendingSignupStep();
      utils.reportError(3, `步骤 3：注册密码不符合页面规则，请检查默认登录密码设置。详情：${passwordErrorText}`);
      return;
    }
    if (!isSignupPasswordCreationPageReady()) {
      return;
    }
    utils.log('步骤 3：页面切换后已进入注册密码页，继续填写密码...');
    try {
      await finishStep3OnPasswordPage(pending.payload);
    } catch (error) {
      clearPendingSignupStep();
      utils.reportError(3, error.message || String(error));
    }
  }
}

async function step6Login(payload) {
  const { address, password, loginPassword } = payload;
  if (!address) {
    throw new Error('登录时缺少邮箱地址');
  }

  if (isProfileSetupPageReady()) {
    utils.log('步骤 6：当前页面已是资料页，准备回到步骤 5 补全资料。', 'warn');
    return { ok: true, needsProfileCompletion: true };
  }

  const emailInput = await utils.waitForElement(
    'input[type="email"], input[name="email"], input[name="username"], input[placeholder*="email" i]',
    15000
  );
  utils.setInputValue(emailInput, address);

  const submitButton = helpers.queryFirst(['button[type="submit"]', 'button[name="continue"]']);
  if (submitButton) {
    utils.clickElement(submitButton);
    await utils.sleep(1200);
  }

  const startedAt = Date.now();
  let passwordInput = null;
  let oneTimeCodeAttempted = false;
  while (Date.now() - startedAt < 5000) {
    passwordInput = document.querySelector('input[type="password"]');
    const oneTimeCodeTrigger = findOneTimeCodeLoginTrigger();
    const path = (globalThis.HotmailRegisterLoginStrategy?.chooseStep6LoginPath || (() => 'wait'))({
      hasProfileSetupPage: isProfileSetupPageReady(),
      hasOneTimeCodeTrigger: Boolean(oneTimeCodeTrigger),
      hasVerificationPage: isLoginVerificationStageReady(),
      hasConsentPage: isStep8Ready(),
      hasPasswordInput: Boolean(passwordInput && isVisibleElement(passwordInput)),
    });

    if (path === 'profile') {
      utils.log('步骤 6：邮箱提交后进入资料页，准备回到步骤 5 补全资料。', 'warn');
      return { ok: true, needsProfileCompletion: true };
    }
    if (path === 'consent') {
      return { ok: true, needsOTP: false };
    }
    if (path === 'otp') {
      utils.log('步骤 6：已进入一次性邮箱验证码登录流程。', 'ok');
      return { ok: true, needsOTP: true };
    }
    if (path === 'one_time_code' && !oneTimeCodeAttempted && oneTimeCodeTrigger) {
      oneTimeCodeAttempted = true;
      utils.log('步骤 6：检测到一次性验证码登录入口，优先切换...', 'info');
      utils.clickElement(oneTimeCodeTrigger);
      await utils.sleep(1200);
      continue;
    }
    if (path === 'password') {
      break;
    }
    if (isProfileSetupPageReady()) {
      utils.log('步骤 6：邮箱提交后进入资料页，准备回到步骤 5 补全资料。', 'warn');
      return { ok: true, needsProfileCompletion: true };
    }
    await utils.sleep(200);
  }

  if (passwordInput) {
    if (oneTimeCodeAttempted) {
      utils.log('步骤 6：一次性验证码登录未切换成功，回退密码登录。', 'warn');
    }
    const resolvedPassword = loginPassword || password || '';
    utils.log('步骤 6：检测到密码输入框，正在使用默认登录密码...');
    utils.setInputValue(passwordInput, resolvedPassword);
    const submitPasswordButton = helpers.queryFirst(['button[type="submit"]', 'button[name="continue"]']);
    if (submitPasswordButton) {
      utils.clickElement(submitPasswordButton);
    }

    const waitAfterPasswordStartedAt = Date.now();
    while (Date.now() - waitAfterPasswordStartedAt < 6000) {
      if (isProfileSetupPageReady()) {
        utils.log('步骤 6：密码提交后进入资料页，准备回到步骤 5 补全资料。', 'warn');
        return { ok: true, needsProfileCompletion: true };
      }
      if (isStep8Ready()) {
        utils.log('步骤 6：密码登录已通过，页面已进入授权阶段。', 'ok');
        return { ok: true, needsOTP: false };
      }
      if (isLoginVerificationStageReady()) {
        utils.log('步骤 6：密码已提交，准备进入登录验证码阶段。');
        return { ok: true, needsOTP: true };
      }
      await utils.sleep(200);
    }

    utils.log('步骤 6：密码已提交，暂未确认页面状态，继续按需进入登录验证码阶段。', 'warn');
    return { ok: true, needsOTP: true };
  }

  utils.log('步骤 6：未出现密码输入框，转入登录验证码链路。', 'warn');
  return { ok: true, needsOTP: true };
}

async function prepareLoginCodeFlow(timeout = 15000) {
  if (helpers.getCodeInput()) {
    return { ready: true, mode: 'code_input' };
  }

  if (isLoginVerificationStageReady()) {
    return { ready: true, mode: 'verification_page' };
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const codeInput = helpers.getCodeInput();
    if (codeInput) {
      return { ready: true, mode: 'code_input' };
    }

    if (isLoginVerificationStageReady()) {
      return { ready: true, mode: 'verification_page' };
    }

    const trigger = findOneTimeCodeLoginTrigger();
    if (trigger) {
      utils.clickElement(trigger);
      await utils.sleep(1200);
      continue;
    }

    await utils.sleep(200);
  }

  throw new Error(`无法切换到一次性验证码验证页面。URL: ${location.href}`);
}

function triggerNativeResendAction(resendButton) {
  if (!resendButton) {
    throw new Error('重新发送验证码按钮不存在。');
  }

  const form = resendButton.form || resendButton.closest?.('form') || null;
  const tagName = String(resendButton.tagName || '').toUpperCase();
  const type = String(resendButton.getAttribute?.('type') || resendButton.type || '').toLowerCase();
  const canUseSubmitter = tagName === 'BUTTON' || (tagName === 'INPUT' && /submit|image/.test(type));

  if (typeof resendButton.click === 'function') {
    resendButton.focus?.();
    resendButton.click();
    return;
  }

  if (form && typeof form.requestSubmit === 'function' && canUseSubmitter) {
    resendButton.focus?.();
    form.requestSubmit(resendButton);
    return;
  }

  utils.clickElement(resendButton);
}

async function resendVerificationCode(step, timeout = 45000) {
  if (step === 7) {
    await prepareLoginCodeFlow();
  }

  const startedAt = Date.now();
  let loggedWaiting = false;

  while (Date.now() - startedAt < timeout) {
    const action = findResendVerificationCodeTrigger({ allowDisabled: true });
    if (action && isActionEnabled(action)) {
      utils.log(`步骤 ${step}：重新发送验证码按钮已可用。`);
      await utils.humanPause(350, 900);
      triggerNativeResendAction(action);
      await utils.sleep(1200);
      return {
        resent: true,
        buttonText: getActionText(action),
      };
    }

    if (action && !loggedWaiting) {
      loggedWaiting = true;
      utils.log(`步骤 ${step}：正在等待重新发送验证码按钮变为可点击...`);
    }

    await utils.sleep(250);
  }

  throw new Error(`无法点击重新发送验证码按钮。URL: ${location.href}`);
}

async function fillCode(payload) {
  if (payload.step === 7) {
    await prepareLoginCodeFlow();
  }
  const codeInput = helpers.getCodeInput();
  if (!codeInput) {
    throw new Error('未找到验证码输入框');
  }
  utils.setInputValue(codeInput, payload.code);

  const submitButton = helpers.queryFirst(['button[type="submit"]', 'button[name="continue"]']);
  if (submitButton) {
    utils.clickElement(submitButton);
  }
  return { ok: true };
}

async function step5FillProfile() {
  const profile = helpers.buildRandomProfile?.() || {
    firstName: 'Ethan',
    lastName: 'Carter',
    fullName: 'Ethan Carter',
    age: '26',
    birthday: '2000-01-01',
  };
  const waitStartedAt = Date.now();
  let singleNameInput = null;
  let firstNameInput = null;
  let lastNameInput = null;
  let ageInput = null;
  let birthdayInput = null;

  while (Date.now() - waitStartedAt < 10000) {
    singleNameInput = document.querySelector('input[name="name"], input[placeholder*="全名"], input[autocomplete="name"]');
    firstNameInput = document.querySelector('input[name="first_name"], input[autocomplete="given-name"]');
    lastNameInput = document.querySelector('input[name="last_name"], input[autocomplete="family-name"]');
    ageInput = document.querySelector('input[name="age"], input[inputmode="numeric"], input[type="number"]');
    birthdayInput = document.querySelector('input[name="birthday"]');

    const hasNameField = Boolean(
      (singleNameInput && isVisibleElement(singleNameInput))
      || ((firstNameInput && isVisibleElement(firstNameInput)) && (lastNameInput && isVisibleElement(lastNameInput)))
    );
    const hasProfileField = Boolean(
      (ageInput && isVisibleElement(ageInput))
      || birthdayInput
    );

    if (hasNameField && hasProfileField) {
      break;
    }
    await utils.sleep(200);
  }

  if (singleNameInput && isVisibleElement(singleNameInput)) {
    utils.setInputValue(singleNameInput, profile.fullName);
    utils.log(`步骤 5：姓名已填写：${profile.fullName}`);
  } else if ((firstNameInput && isVisibleElement(firstNameInput)) && (lastNameInput && isVisibleElement(lastNameInput))) {
    utils.setInputValue(firstNameInput, profile.firstName);
    utils.setInputValue(lastNameInput, profile.lastName);
    utils.log(`步骤 5：姓名已填写：${profile.fullName}`);
  } else {
    throw new Error(`步骤 5：未找到可填写的姓名字段。URL: ${location.href}`);
  }

  if (ageInput && isVisibleElement(ageInput)) {
    utils.setInputValue(ageInput, profile.age);
    utils.log(`步骤 5：年龄已填写：${profile.age}`);
  } else if (birthdayInput) {
    birthdayInput.value = profile.birthday;
    birthdayInput.dispatchEvent(new Event('input', { bubbles: true }));
    birthdayInput.dispatchEvent(new Event('change', { bubbles: true }));
    utils.log(`步骤 5：生日已填写：${profile.birthday}`);
  } else {
    throw new Error(`步骤 5：未找到可填写的年龄或生日字段。URL: ${location.href}`);
  }

  const submitButton = helpers.queryFirst(['button[type="submit"]', 'button[name="continue"]']);
  if (!submitButton) {
    throw new Error(`步骤 5：未找到资料页提交按钮。URL: ${location.href}`);
  }

  utils.clickElement(submitButton);
  utils.log('步骤 5：资料已提交，正在等待页面结果...');

  const outcome = await waitForStep5SubmitOutcome();
  if (outcome.invalidProfile) {
    throw new Error(`步骤 5：${outcome.errorText}`);
  }
  return { ok: true, addPhonePage: Boolean(outcome.addPhonePage) };
}

async function step8FindAndClick() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    if (isAddPhonePageReady()) {
      throw new Error(`当前页面已进入手机号页面，不是 OAuth 授权同意页。URL: ${location.href}`);
    }

    const continueButton = getPrimaryContinueButton();
    if (continueButton && isStep8Ready() && isActionEnabled(continueButton)) {
      continueButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      continueButton.focus?.();
      await utils.sleep(250);
      const rect = continueButton.getBoundingClientRect();
      let nativeClicked = false;
      try {
        continueButton.click?.();
        nativeClicked = true;
      } catch {
        nativeClicked = false;
      }
      return {
        ok: true,
        clicked: nativeClicked,
        buttonText: getActionText(continueButton),
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          centerX: rect.left + (rect.width / 2),
          centerY: rect.top + (rect.height / 2),
        },
      };
    }

    await utils.sleep(150);
  }

  throw new Error(`在 OAuth 同意页未找到可点击的“继续”按钮。URL: ${location.href}`);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const tasks = {
    EXECUTE_STEP: async () => {
      if (message.step === 2) return step2OpenSignup();
      if (message.step === 3) return step3FillCredentials(message.payload || {});
      if (message.step === 5) return step5FillProfile();
      if (message.step === 6) return step6Login(message.payload || {});
      if (message.step === 8) return step8FindAndClick();
      return { ok: true, skipped: true };
    },
    FILL_CODE: async () => fillCode({ ...(message.payload || {}), step: message.step }),
    PREPARE_LOGIN_CODE: async () => prepareLoginCodeFlow(),
    RESEND_VERIFICATION_CODE: async () => resendVerificationCode(message.step),
    STEP8_FIND_AND_CLICK: async () => step8FindAndClick(),
  };

  const task = tasks[message.type];
  if (!task) return;

  task()
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});

void resumePendingSignupStep();
