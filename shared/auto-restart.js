export function buildAutoRestartRuntimeUpdates({
  mode = 'current',
  currentAccountIndex = 0,
} = {}) {
  const nextIndex = mode === 'next'
    ? Math.max(0, Number(currentAccountIndex) + 1)
    : Math.max(0, Number(currentAccountIndex) || 0);

  return {
    currentAccountIndex: nextIndex,
    currentAccount: null,
    currentEmailRecord: null,
    currentProfile: null,
    callbackTabId: null,
    localhostUrl: '',
    lastSignupCode: '',
    lastLoginCode: '',
    autoPaused: false,
    stopRequested: false,
  };
}

