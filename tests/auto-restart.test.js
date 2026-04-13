import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAutoRestartRuntimeUpdates } from '../shared/auto-restart.js';

test('buildAutoRestartRuntimeUpdates keeps current account index when restarting current run', () => {
  const updates = buildAutoRestartRuntimeUpdates({
    mode: 'current',
    currentAccountIndex: 3,
  });

  assert.deepEqual(updates, {
    currentAccountIndex: 3,
    currentAccount: null,
    currentEmailRecord: null,
    currentProfile: null,
    callbackTabId: null,
    localhostUrl: '',
    lastSignupCode: '',
    lastLoginCode: '',
    autoPaused: false,
    stopRequested: false,
  });
});

test('buildAutoRestartRuntimeUpdates advances to next account when restarting with next account', () => {
  const updates = buildAutoRestartRuntimeUpdates({
    mode: 'next',
    currentAccountIndex: 3,
  });

  assert.deepEqual(updates, {
    currentAccountIndex: 4,
    currentAccount: null,
    currentEmailRecord: null,
    currentProfile: null,
    callbackTabId: null,
    localhostUrl: '',
    lastSignupCode: '',
    lastLoginCode: '',
    autoPaused: false,
    stopRequested: false,
  });
});

