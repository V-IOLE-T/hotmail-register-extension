import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findNextAvailableAccount,
  getAccountStatus,
  markAccountStatus,
  resolveCurrentAccountSelection,
} from '../shared/account-ledger.js';

test('findNextAvailableAccount skips completed accounts', () => {
  const accounts = [
    { address: 'used@hotmail.com' },
    { address: 'fresh@hotmail.com' },
  ];
  const ledger = {
    'used@hotmail.com': { status: 'completed', updatedAt: '2026-04-12T00:00:00.000Z' },
  };

  const result = findNextAvailableAccount(accounts, ledger);

  assert.equal(result.index, 1);
  assert.equal(result.account.address, 'fresh@hotmail.com');
});

test('markAccountStatus normalizes address and writes status', () => {
  const ledger = markAccountStatus({}, ' User@Hotmail.com ', 'completed');

  assert.equal(getAccountStatus(ledger, 'user@hotmail.com').status, 'completed');
});

test('findNextAvailableAccount returns null when all accounts are completed', () => {
  const accounts = [
    { address: 'used1@hotmail.com' },
    { address: 'used2@hotmail.com' },
  ];
  const ledger = {
    'used1@hotmail.com': { status: 'completed' },
    'used2@hotmail.com': { status: 'completed' },
  };

  const result = findNextAvailableAccount(accounts, ledger);
  assert.equal(result, null);
});

test('resolveCurrentAccountSelection respects currentAccountIndex and returns the matched cursor', () => {
  const accounts = [
    { address: 'first@hotmail.com' },
    { address: 'second@hotmail.com' },
    { address: 'third@hotmail.com' },
  ];

  const result = resolveCurrentAccountSelection({
    accounts,
    ledger: {},
    startIndex: 1,
  });

  assert.deepEqual(result, {
    account: { address: 'second@hotmail.com' },
    index: 1,
  });
});

test('resolveCurrentAccountSelection skips accounts that already have the 已注册 tag', () => {
  const accounts = [
    { address: 'registered@hotmail.com', tags: [{ name: '已注册' }] },
    { address: 'fresh@hotmail.com', tags: [] },
  ];

  const result = resolveCurrentAccountSelection({
    accounts,
    ledger: {},
    startIndex: 0,
  });

  assert.deepEqual(result, {
    account: { address: 'fresh@hotmail.com', tags: [] },
    index: 1,
  });
});

test('resolveCurrentAccountSelection falls back to the beginning when startIndex is stale', () => {
  const accounts = [
    { address: 'duck@cstea.shop', tags: [] },
    { address: 'gpt@vmm.indev', tags: [] },
  ];

  const result = resolveCurrentAccountSelection({
    accounts,
    ledger: {},
    startIndex: 99,
  });

  assert.deepEqual(result, {
    account: { address: 'duck@cstea.shop', tags: [] },
    index: 0,
  });
});
