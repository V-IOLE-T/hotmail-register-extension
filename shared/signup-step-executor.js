import { resolveLoginPassword } from './login-password.js';

export async function executeSignupStepCommand({
  step,
  payload = null,
  state,
  ensureCurrentAccount,
  resolveCurrentProfile,
  openOauthUrl,
  addLog,
  sendToActiveAuthTab,
  sendToTab,
} = {}) {
  if (step === 3) {
    const account = await ensureCurrentAccount(state);
    const password = resolveLoginPassword({
      defaultLoginPassword: state?.defaultLoginPassword,
      accountPassword: account.password,
    });
    return sendToActiveAuthTab({
      type: 'EXECUTE_STEP',
      step,
      payload: {
        ...account,
        password,
      },
    });
  }

  if (step === 5) {
    const account = await ensureCurrentAccount(state);
    const profile = await resolveCurrentProfile?.(state, account);
    return sendToActiveAuthTab({
      type: 'EXECUTE_STEP',
      step,
      payload: profile || {},
    });
  }

  if (step === 6) {
    const account = await ensureCurrentAccount(state);
    const authTab = await openOauthUrl(state.oauthUrl);
    if (!authTab?.id) {
      throw new Error('步骤 6：重新打开 OAuth 页面后未获得有效标签页');
    }
    await addLog('步骤 6：已重新打开 OAuth 页面，准备登录...', 'info');
    return sendToTab(authTab.id, { type: 'EXECUTE_STEP', step, payload: account });
  }

  return sendToActiveAuthTab({ type: 'EXECUTE_STEP', ...(payload || {}), step });
}
