import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findLoopbackCallbackUrl,
  isEmailVerificationUrl,
  isExistingAccountSignalText,
  isExplicitSignupFlowPageText,
  isLoginFlowUrl,
  isLoginPasswordPageText,
  isProfileSetupPageText,
  isSignupPasswordValidationErrorText,
  isSignupLandingPageText,
  isSignupActionText,
  isSignupFlowUrl,
  isSignupPageText,
  isLoopbackCallbackUrl,
  shouldTreatAsDirectLoginFlow,
  shouldUseStep8ContinueButton,
} from '../shared/oauth-step-helpers-core.js';

test('isLoopbackCallbackUrl matches localhost callback URLs', () => {
  assert.equal(isLoopbackCallbackUrl('http://localhost:3000/callback?code=1'), true);
  assert.equal(isLoopbackCallbackUrl('https://127.0.0.1:8080/callback'), true);
  assert.equal(isLoopbackCallbackUrl('https://example.com/callback'), false);
});

test('findLoopbackCallbackUrl returns the first matching callback URL', () => {
  const result = findLoopbackCallbackUrl([
    'https://example.com',
    'http://localhost:3000/callback?code=1',
    'http://localhost:3000/other',
  ]);

  assert.equal(result, 'http://localhost:3000/callback?code=1');
});

test('shouldUseStep8ContinueButton requires consent context and no blocking pages', () => {
  assert.equal(shouldUseStep8ContinueButton({
    hasContinueButton: true,
    isConsentUrl: true,
    isVerificationPage: false,
    isAddPhonePage: false,
  }), true);

  assert.equal(shouldUseStep8ContinueButton({
    hasContinueButton: true,
    isConsentUrl: true,
    isVerificationPage: true,
    isAddPhonePage: false,
  }), false);
});

test('isSignupActionText only matches explicit signup actions', () => {
  assert.equal(isSignupActionText('Sign up'), true);
  assert.equal(isSignupActionText('创建账号'), true);
  assert.equal(isSignupActionText('Continue'), false);
  assert.equal(isSignupActionText('Log in'), false);
});

test('isSignupPageText matches signup-only page copy', () => {
  assert.equal(isSignupPageText('Create your password to continue'), true);
  assert.equal(isSignupPageText('First name Last name'), true);
  assert.equal(isSignupPageText('Enter your email to continue'), false);
});

test('isProfileSetupPageText matches age and birthday profile screens', () => {
  assert.equal(isProfileSetupPageText('First name Last name'), true);
  assert.equal(isProfileSetupPageText('Full name Birthday'), true);
  assert.equal(isProfileSetupPageText('Age Continue'), true);
  assert.equal(isProfileSetupPageText('Enter your email to continue'), false);
});

test('isSignupLandingPageText matches create-account landing screens', () => {
  assert.equal(isSignupLandingPageText('Create an account Continue with Google Continue with Apple Already have an account? Log in'), true);
  assert.equal(isSignupLandingPageText('创建帐户 电子邮件地址 已经有帐户了？请登录 继续使用 Google 登录 继续使用 Apple 登录 继续使用 Microsoft 登录'), true);
  assert.equal(isSignupLandingPageText('Create your password to continue'), false);
  assert.equal(isSignupLandingPageText('Enter your password Forgot password'), false);
});

test('isExplicitSignupFlowPageText only matches real signup flow pages', () => {
  assert.equal(isExplicitSignupFlowPageText('Create an account Continue with Google Already have an account? Log in'), true);
  assert.equal(isExplicitSignupFlowPageText('创建帐户 电子邮件地址 已经有帐户了？请登录 继续使用 Google 登录'), true);
  assert.equal(isExplicitSignupFlowPageText('Create your password to continue'), true);
  assert.equal(isExplicitSignupFlowPageText('First name Last name Age'), true);
  assert.equal(isExplicitSignupFlowPageText('Enter your password Log in with a one-time code'), false);
});

test('isLoginPasswordPageText matches login-only password screens', () => {
  assert.equal(isLoginPasswordPageText('Enter your password Forgot password? Log in with a one-time code'), true);
  assert.equal(isLoginPasswordPageText('Incorrect email address or password Continue'), true);
  assert.equal(isLoginPasswordPageText('Create your password to continue'), false);
  assert.equal(isLoginPasswordPageText('First name Last name Age'), false);
});

test('isSignupFlowUrl matches signup routes and hints only', () => {
  assert.equal(isSignupFlowUrl('https://auth.openai.com/u/signup/identifier?state=1'), true);
  assert.equal(isSignupFlowUrl('https://auth.openai.com/create-account/password?state=1'), true);
  assert.equal(isSignupFlowUrl('https://auth.openai.com/u/login/identifier?screen_hint=signup'), true);
  assert.equal(isSignupFlowUrl('https://auth.openai.com/log-in'), false);
  assert.equal(isSignupFlowUrl('https://auth.openai.com/u/login/password?state=1'), false);
});

test('isLoginFlowUrl matches login routes only', () => {
  assert.equal(isLoginFlowUrl('https://auth.openai.com/log-in'), true);
  assert.equal(isLoginFlowUrl('https://auth.openai.com/log-in/password'), true);
  assert.equal(isLoginFlowUrl('https://auth.openai.com/u/login/identifier?state=1'), true);
  assert.equal(isLoginFlowUrl('https://auth.openai.com/create-account/password?state=1'), false);
});

test('isEmailVerificationUrl matches verification routes only', () => {
  assert.equal(isEmailVerificationUrl('https://auth.openai.com/email-verification'), true);
  assert.equal(isEmailVerificationUrl('https://auth.openai.com/u/login/email-verification?state=1'), true);
  assert.equal(isEmailVerificationUrl('https://auth.openai.com/log-in/password'), false);
});

test('isExistingAccountSignalText only matches explicit account-exists errors', () => {
  assert.equal(isExistingAccountSignalText('Account associated with this email address already exists'), true);
  assert.equal(isExistingAccountSignalText('This email address is already in use'), true);
  assert.equal(isExistingAccountSignalText('Already have an account? Log in'), false);
});

test('shouldTreatAsDirectLoginFlow only switches on explicit login pages', () => {
  assert.equal(shouldTreatAsDirectLoginFlow({
    url: 'https://auth.openai.com/u/login/password?state=1',
    text: 'Enter your password Forgot password Log in with a one-time code',
    hasVerificationPage: false,
    hasProfileSetupPage: false,
    hasSignupIdentifierPage: false,
    hasSignupPasswordPage: false,
  }), true);

  assert.equal(shouldTreatAsDirectLoginFlow({
    url: 'https://auth.openai.com/u/login/identifier?screen_hint=signup&state=1',
    text: 'Create an account Email address Already have an account? Log in',
    hasVerificationPage: false,
    hasProfileSetupPage: false,
    hasSignupIdentifierPage: true,
    hasSignupPasswordPage: false,
  }), false);

  assert.equal(shouldTreatAsDirectLoginFlow({
    url: 'https://auth.openai.com/u/login/password?screen_hint=signup&state=1',
    text: 'Create your password to continue',
    hasVerificationPage: false,
    hasProfileSetupPage: false,
    hasSignupIdentifierPage: false,
    hasSignupPasswordPage: true,
  }), false);
});

test('isSignupPasswordValidationErrorText matches password rule errors only', () => {
  assert.equal(isSignupPasswordValidationErrorText('Your password must contain: At least 12 characters'), true);
  assert.equal(isSignupPasswordValidationErrorText('密码必须包含至少 12 个字符'), true);
  assert.equal(isSignupPasswordValidationErrorText('Create your password to continue'), false);
});
