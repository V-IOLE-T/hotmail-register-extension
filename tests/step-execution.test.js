import test from 'node:test';
import assert from 'node:assert/strict';

import { executeSignupStepCommand } from '../shared/signup-step-executor.js';

test('executeSignupStepCommand sends step 3 with preferred default login password', async () => {
  const calls = [];
  const state = {
    defaultLoginPassword: 'OpenAI-Password-123',
  };
  const account = {
    address: 'user@hotmail.com',
    password: 'short-mail-pass',
    clientId: 'cid-1',
    refreshToken: 'rt-1',
  };

  const result = await executeSignupStepCommand({
    step: 3,
    state,
    ensureCurrentAccount: async (receivedState) => {
      calls.push(['ensureCurrentAccount', receivedState]);
      return account;
    },
    sendToActiveAuthTab: async (message) => {
      calls.push(['sendToActiveAuthTab', message]);
      return { ok: true, message };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    message: {
      type: 'EXECUTE_STEP',
      step: 3,
      payload: {
        ...account,
        password: 'OpenAI-Password-123',
      },
    },
  });

  assert.deepEqual(calls, [
    ['ensureCurrentAccount', state],
    ['sendToActiveAuthTab', {
      type: 'EXECUTE_STEP',
      step: 3,
      payload: {
        ...account,
        password: 'OpenAI-Password-123',
      },
    }],
  ]);
});

test('executeSignupStepCommand sends step 6 to the reopened auth tab', async () => {
  const calls = [];
  const state = {
    oauthUrl: 'https://auth.openai.com/oauth',
  };
  const account = {
    address: 'user@hotmail.com',
    password: 'secret',
  };

  const result = await executeSignupStepCommand({
    step: 6,
    state,
    ensureCurrentAccount: async (receivedState) => {
      calls.push(['ensureCurrentAccount', receivedState]);
      return account;
    },
    openOauthUrl: async (oauthUrl) => {
      calls.push(['openOauthUrl', oauthUrl]);
      return { id: 42, url: oauthUrl };
    },
    addLog: async (message, level) => {
      calls.push(['addLog', message, level]);
    },
    sendToActiveAuthTab: async () => {
      calls.push(['sendToActiveAuthTab']);
      return { wrongTarget: true };
    },
    sendToTab: async (tabId, message) => {
      calls.push(['sendToTab', tabId, message]);
      return { ok: true, tabId, message };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    tabId: 42,
    message: {
      type: 'EXECUTE_STEP',
      step: 6,
      payload: account,
    },
  });

  assert.deepEqual(calls, [
    ['ensureCurrentAccount', state],
    ['openOauthUrl', 'https://auth.openai.com/oauth'],
    ['addLog', '步骤 6：已重新打开 OAuth 页面，准备登录...', 'info'],
    ['sendToTab', 42, { type: 'EXECUTE_STEP', step: 6, payload: account }],
  ]);
});

test('executeSignupStepCommand sends step 5 with resolved current profile', async () => {
  const calls = [];
  const state = {};
  const account = {
    address: 'user@hotmail.com',
  };
  const profile = {
    firstName: 'Liam',
    lastName: 'Stone',
    fullName: 'Liam Stone',
    birthday: '1999-03-08',
    age: '27',
  };

  const result = await executeSignupStepCommand({
    step: 5,
    state,
    ensureCurrentAccount: async (receivedState) => {
      calls.push(['ensureCurrentAccount', receivedState]);
      return account;
    },
    resolveCurrentProfile: async (receivedState, receivedAccount) => {
      calls.push(['resolveCurrentProfile', receivedState, receivedAccount]);
      return profile;
    },
    sendToActiveAuthTab: async (message) => {
      calls.push(['sendToActiveAuthTab', message]);
      return { ok: true, message };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    message: {
      type: 'EXECUTE_STEP',
      step: 5,
      payload: profile,
    },
  });

  assert.deepEqual(calls, [
    ['ensureCurrentAccount', state],
    ['resolveCurrentProfile', state, account],
    ['sendToActiveAuthTab', {
      type: 'EXECUTE_STEP',
      step: 5,
      payload: profile,
    }],
  ]);
});
