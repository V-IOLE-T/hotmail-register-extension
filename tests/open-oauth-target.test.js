import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseOauthTabCandidate, isAuthHostUrl, listAuthTabIds } from '../shared/open-oauth-target.js';

test('isAuthHostUrl matches OpenAI auth hosts only', () => {
  assert.equal(isAuthHostUrl('https://auth.openai.com/u/login'), true);
  assert.equal(isAuthHostUrl('https://accounts.openai.com/v1'), true);
  assert.equal(isAuthHostUrl('http://127.0.0.1:5001/management.html#/oauth'), false);
});

test('chooseOauthTabCandidate does not reuse CPA tab and returns null when no auth tab exists', () => {
  const result = chooseOauthTabCandidate({
    currentTab: { id: 1, url: 'http://127.0.0.1:5001/management.html#/oauth' },
    tabs: [{ id: 1, url: 'http://127.0.0.1:5001/management.html#/oauth' }],
  });

  assert.equal(result, null);
});

test('chooseOauthTabCandidate reuses existing auth tab when current tab is CPA', () => {
  const result = chooseOauthTabCandidate({
    currentTab: { id: 1, url: 'http://127.0.0.1:5001/management.html#/oauth' },
    tabs: [
      { id: 1, url: 'http://127.0.0.1:5001/management.html#/oauth' },
      { id: 9, url: 'https://auth.openai.com/u/login' },
    ],
  });

  assert.deepEqual(result, { id: 9, url: 'https://auth.openai.com/u/login' });
});

test('chooseOauthTabCandidate prefers the stored auth tab when it is still available', () => {
  const result = chooseOauthTabCandidate({
    currentTab: { id: 1, url: 'http://127.0.0.1:5001/management.html#/oauth' },
    preferredTabId: 10,
    tabs: [
      { id: 1, url: 'http://127.0.0.1:5001/management.html#/oauth' },
      { id: 9, url: 'https://auth.openai.com/u/login' },
      { id: 10, url: 'https://auth.openai.com/create-account' },
    ],
  });

  assert.deepEqual(result, { id: 10, url: 'https://auth.openai.com/create-account' });
});

test('listAuthTabIds returns only OpenAI auth tabs', () => {
  const result = listAuthTabIds([
    { id: 1, url: 'http://127.0.0.1:5001/management.html#/oauth' },
    { id: 9, url: 'https://auth.openai.com/u/login' },
    { id: 10, url: 'https://accounts.openai.com/v1' },
    { id: 11, url: 'https://example.com' },
  ]);

  assert.deepEqual(result, [9, 10]);
});
