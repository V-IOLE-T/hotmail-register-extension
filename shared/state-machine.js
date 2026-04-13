export const DEFAULT_SETTINGS = {
  apiKey: '',
  mailApiBaseUrl: '',
  defaultLoginPassword: '',
  oauthUrl: '',
  vpsUrl: '',
  vpsPassword: '',
  accountPoolText: '',
  autoImport: false,
  runCount: 1,
  skipFailedAccounts: false,
  pollIntervalSec: 3,
  pollTimeoutSec: 60,
  mailKeyword: '',
  mailFromKeyword: '',
  recordSuccessResults: false,
  successResults: [],
  usedAccounts: {},
  mailProvider: 'outlook',
  appleEmailBaseUrl: 'https://www.appleemail.top',
};

export const DEFAULT_RUNTIME = {
  currentAccountIndex: 0,
  selectedAccountAddress: '',
  currentAccount: null,
  currentEmailRecord: null,
  currentProfile: null,
  authTabId: null,
  callbackTabId: null,
  localhostUrl: '',
  lastSignupCode: '',
  lastLoginCode: '',
  autoRunning: false,
  autoPaused: false,
  stopRequested: false,
  autoCurrentRun: 0,
  autoTotalRuns: 0,
  pendingAutoAction: '',
  logs: [],
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
};

export function sanitizeSettings(input = {}) {
  return {
    apiKey: String(input.apiKey || '').trim(),
    mailApiBaseUrl: String(input.mailApiBaseUrl || '').trim(),
    defaultLoginPassword: String(input.defaultLoginPassword || '').trim(),
    oauthUrl: String(input.oauthUrl || '').trim(),
    vpsUrl: String(input.vpsUrl || '').trim(),
    vpsPassword: String(input.vpsPassword || ''),
    accountPoolText: String(input.accountPoolText || ''),
    autoImport: Boolean(input.autoImport),
    runCount: Math.max(1, Number(input.runCount) || DEFAULT_SETTINGS.runCount),
    skipFailedAccounts: Boolean(input.skipFailedAccounts),
    pollIntervalSec: Math.max(1, Number(input.pollIntervalSec) || DEFAULT_SETTINGS.pollIntervalSec),
    pollTimeoutSec: Math.max(5, Number(input.pollTimeoutSec) || DEFAULT_SETTINGS.pollTimeoutSec),
    mailKeyword: String(input.mailKeyword || '').trim(),
    mailFromKeyword: String(input.mailFromKeyword || '').trim(),
    recordSuccessResults: Boolean(input.recordSuccessResults),
    successResults: Array.isArray(input.successResults) ? [...input.successResults] : [],
    usedAccounts: input.usedAccounts && typeof input.usedAccounts === 'object'
      ? { ...input.usedAccounts }
      : {},
    mailProvider: ['outlook', 'appleemail'].includes(input.mailProvider)
      ? input.mailProvider
      : 'outlook',
    appleEmailBaseUrl: String(input.appleEmailBaseUrl || '').trim(),
  };
}

export function mergeLogs(currentLogs = [], entry) {
  return [...currentLogs, entry].slice(-200);
}
