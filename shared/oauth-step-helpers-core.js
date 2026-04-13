export function normalizeInlineText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function parseUrl(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function isLoopbackCallbackUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  return parsed.hostname === 'localhost'
    || parsed.hostname === '127.0.0.1'
    || parsed.hostname === '::1'
    || parsed.hostname === '[::1]';
}

export function findLoopbackCallbackUrl(candidates = []) {
  for (const candidate of candidates) {
    if (isLoopbackCallbackUrl(candidate)) {
      return candidate;
    }
  }

  return null;
}

function findMatchingText(candidates = [], pattern) {
  for (const candidate of candidates) {
    const normalized = normalizeInlineText(candidate);
    if (normalized && pattern.test(normalized)) {
      return normalized;
    }
  }

  return '';
}

export function findStep9SuccessText(candidates = []) {
  return findMatchingText(
    candidates,
    /认证成功|authentication\s+successful|authenticated\s+successfully|success(?:!|$|\b)/i
  );
}

export function findStep9TimeoutText(candidates = []) {
  return findMatchingText(candidates, /认证失败:\s*Timeout waiting for OAuth callback/i);
}

export function isOAuthConsentUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }

  return /\/sign-in-with-chatgpt\/[^/]+\/consent(?:[/?#]|$)/i.test(parsed.pathname || '');
}

export function isSignupFlowUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }

  const pathname = parsed.pathname || '';
  const params = parsed.searchParams;
  return /\/u\/signup(?:[/?#]|$)|\/signup(?:[/?#]|$)|\/create-account(?:[/?#]|$)/i.test(pathname)
    || /signup/i.test(params.get('screen_hint') || '')
    || /signup/i.test(params.get('mode') || '')
    || /signup/i.test(params.get('action') || '');
}

export function isLoginFlowUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }

  const pathname = parsed.pathname || '';
  const params = parsed.searchParams;
  return /\/u\/login(?:[/?#]|$)|\/log-in(?:[/?#]|$)/i.test(pathname)
    || /login/i.test(params.get('screen_hint') || '')
    || /login/i.test(params.get('mode') || '')
    || /login/i.test(params.get('action') || '');
}

export function isEmailVerificationUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }

  return /\/email-verification(?:[/?#]|$)/i.test(parsed.pathname || '');
}

export function isStep8ActionText(text) {
  return /继续|continue|authorize|allow|同意|批准|approve|accept/i.test(normalizeInlineText(text));
}

export function isSignupActionText(text) {
  return /sign\s*up|create\s+(?:an?\s+)?account|注册|创建账号|创建帐户|signup/i.test(normalizeInlineText(text));
}

export function isSignupPageText(text) {
  return /创建密码|create\s+(?:your\s+)?password|继续创建|继续注册|完成注册|first\s+name|last\s+name|given[-\s]*name|family[-\s]*name/i.test(normalizeInlineText(text));
}

export function isSignupPasswordValidationErrorText(text) {
  return /your\s+password\s+must\s+contain|password\s+must\s+contain|at\s+least\s+12\s+characters|密码必须包含|至少\s*12\s*个字符/i.test(normalizeInlineText(text));
}

export function isProfileSetupPageText(text) {
  return /first\s+name|last\s+name|full\s+name|given[-\s]*name|family[-\s]*name|birthday|birth\s*date|出生日期|生日|年龄|age/i.test(normalizeInlineText(text));
}

export function isLoginPasswordPageText(text) {
  return /enter\s+your\s+password|incorrect\s+email\s+address\s+or\s+password|forgot\s+password|log\s+in\s+with\s+a\s+one[-\s]*time\s+code/i.test(normalizeInlineText(text));
}

export function isExistingAccountSignalText(text) {
  return /account\s+associated\s+with\s+this\s+email\s+address\s+already\s+exists|email\s+address.*already\s+exists|this\s+email\s+address\s+is\s+already\s+in\s+use|该电子邮件地址已被使用|该邮箱已被使用|账户已存在|帐户已存在/i.test(normalizeInlineText(text));
}

export function isSignupLandingPageText(text) {
  return /create\s+an\s+account|continue\s+with\s+google|continue\s+with\s+apple|continue\s+with\s+microsoft|already\s+have\s+an\s+account\?\s*log\s*in|创建(?:帐户|账户|账号)|继续使用\s*(?:google|apple|microsoft)\s*登录|已经有(?:帐户|账户|账号)了？\s*请登录/i.test(normalizeInlineText(text));
}

export function shouldTreatAsDirectLoginFlow(state = {}) {
  const normalizedText = normalizeInlineText(state.text);
  if (!normalizedText && !state.url) {
    return false;
  }

  if (state.hasVerificationPage || state.hasProfileSetupPage || state.hasSignupIdentifierPage || state.hasSignupPasswordPage) {
    return false;
  }

  if (isLoginPasswordPageText(normalizedText)) {
    return true;
  }

  if (!isLoginFlowUrl(state.url) || isSignupFlowUrl(state.url)) {
    return false;
  }

  if (isSignupLandingPageText(normalizedText) || isSignupPageText(normalizedText) || isProfileSetupPageText(normalizedText)) {
    return false;
  }

  return true;
}

export function isExplicitSignupFlowPageText(text) {
  const normalized = normalizeInlineText(text);
  if (!normalized || isLoginPasswordPageText(normalized)) {
    return false;
  }
  return isSignupLandingPageText(normalized)
    || isSignupPageText(normalized)
    || isProfileSetupPageText(normalized);
}

export function shouldUseStep8ContinueButton(state = {}) {
  const hasConsentAction = Boolean(state.hasContinueButton) || Boolean(state.hasActionButton);
  const isConsentPage = Boolean(state.isConsentUrl) || Boolean(state.isConsentText);

  return hasConsentAction
    && !Boolean(state.isVerificationPage)
    && !Boolean(state.isAddPhonePage)
    && isConsentPage;
}

export const oauthStepHelpers = {
  findLoopbackCallbackUrl,
  findStep9SuccessText,
  findStep9TimeoutText,
  isEmailVerificationUrl,
  isExistingAccountSignalText,
  isExplicitSignupFlowPageText,
  isLoginFlowUrl,
  isSignupFlowUrl,
  isLoginPasswordPageText,
  isLoopbackCallbackUrl,
  isOAuthConsentUrl,
  isProfileSetupPageText,
  isSignupActionText,
  isSignupLandingPageText,
  shouldTreatAsDirectLoginFlow,
  isSignupPasswordValidationErrorText,
  isSignupPageText,
  isStep8ActionText,
  normalizeInlineText,
  parseUrl,
  shouldUseStep8ContinueButton,
};
