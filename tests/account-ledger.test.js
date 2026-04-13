import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findAvailableAccountByAddress,
  findNextAvailableAccount,
  getAccountStatus,
  listAvailableAccounts,
  markAccountStatus,
  listSkippedAccounts,
  resolveCurrentAccountSelection,
  summarizeAccountAvailability,
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

test('findAvailableAccountByAddress returns selectable account by exact address', () => {
  const accounts = [
    { address: 'done@outlook.com', tags: [] },
    { address: 'fresh@outlook.com', tags: [] },
  ];
  const ledger = {
    'done@outlook.com': { status: 'completed' },
  };

  const result = findAvailableAccountByAddress(accounts, ledger, 'fresh@outlook.com');

  assert.deepEqual(result, {
    account: { address: 'fresh@outlook.com', tags: [] },
    index: 1,
  });
});

test('findAvailableAccountByAddress returns null when address is already unavailable', () => {
  const accounts = [
    { address: 'done@outlook.com', tags: [] },
    { address: 'tagged@outlook.com', tags: [{ name: '已注册' }] },
  ];
  const ledger = {
    'done@outlook.com': { status: 'completed' },
  };

  assert.equal(findAvailableAccountByAddress(accounts, ledger, 'done@outlook.com'), null);
  assert.equal(findAvailableAccountByAddress(accounts, ledger, 'tagged@outlook.com'), null);
});

test('listAvailableAccounts filters by query and excludes unavailable accounts', () => {
  const accounts = [
    { address: 'done@outlook.com', provider: 'outlook', tags: [] },
    { address: 'fresh@duckmail.live', provider: 'duckmail', tags: [] },
    { address: 'tagged@gptmail.one', provider: 'gptmail', tags: [{ name: '已注册' }] },
  ];
  const ledger = {
    'done@outlook.com': { status: 'completed' },
  };

  const result = listAvailableAccounts(accounts, ledger, { query: 'duck' });

  assert.deepEqual(result, [
    { address: 'fresh@duckmail.live', provider: 'duckmail', tags: [] },
  ]);
});

test('summarizeAccountAvailability counts ledger skips and 已注册 tag skips separately', () => {
  const accounts = [
    { address: 'done@outlook.com', tags: [] },
    { address: 'tagged@outlook.com', tags: [{ name: '已注册' }] },
    { address: 'fresh@outlook.com', tags: [] },
  ];
  const ledger = {
    'done@outlook.com': { status: 'completed' },
  };

  const result = summarizeAccountAvailability(accounts, ledger);

  assert.deepEqual(result, {
    total: 3,
    completedInLedger: 1,
    taggedRegistered: 1,
    available: 1,
  });
});

test('listSkippedAccounts returns skipped addresses grouped by reason', () => {
  const accounts = [
    { address: 'done@outlook.com', tags: [] },
    { address: 'tagged@outlook.com', tags: [{ name: '已注册' }] },
    { address: 'fresh@outlook.com', tags: [] },
  ];
  const ledger = {
    'done@outlook.com': { status: 'completed' },
  };

  const result = listSkippedAccounts(accounts, ledger);

  assert.deepEqual(result, {
    completedInLedger: ['done@outlook.com'],
    taggedRegistered: ['tagged@outlook.com'],
  });
});

test('alias accounts can stay available even when base record carries 已注册 tag', () => {
  const accounts = [
    {
      address: 'user+ABC123@hotmail.com',
      baseAddress: 'user@hotmail.com',
      tags: [{ name: '已注册' }],
      ignoreRegisteredTag: true,
    },
  ];

  const result = resolveCurrentAccountSelection({
    accounts,
    ledger: {},
    startIndex: 0,
  });

  assert.deepEqual(result, {
    account: accounts[0],
    index: 0,
  });
});
