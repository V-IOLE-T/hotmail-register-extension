import test from 'node:test';
import assert from 'node:assert/strict';

import { expandHotmailAliasesForAccount, findBaseAccountByAlias, getHotmailAliasCount } from '../shared/hotmail-aliases.js';

test('expandHotmailAliasesForAccount creates 5 stable aliases for hotmail account', () => {
  const account = {
    address: 'user@hotmail.com',
    aliases: ['legacy@example.com'],
    tags: [{ name: '核心' }],
  };

  const expanded = expandHotmailAliasesForAccount(account);

  assert.equal(expanded.length, getHotmailAliasCount());
  assert.deepEqual(
    new Set(expanded.map((item) => item.address)).size,
    getHotmailAliasCount(),
  );
  expanded.forEach((item, index) => {
    assert.equal(item.baseAddress, 'user@hotmail.com');
    assert.equal(item.isAlias, true);
    assert.equal(item.aliasIndex, index);
    assert.match(item.address, /^user\+[A-Za-z0-9]{6}@hotmail\.com$/);
    assert.equal(item.aliases.includes('user@hotmail.com'), true);
    assert.equal(item.aliases.includes('legacy@example.com'), true);
    assert.equal(item.ignoreRegisteredTag, true);
  });
});

test('expandHotmailAliasesForAccount leaves non-microsoft account unchanged', () => {
  const expanded = expandHotmailAliasesForAccount({
    address: 'user@example.com',
    tags: [],
  });

  assert.deepEqual(expanded, [{
    address: 'user@example.com',
    baseAddress: 'user@example.com',
    tags: [],
    aliases: [],
    isAlias: false,
    aliasIndex: null,
    aliasSuffix: '',
    displayAddress: 'user@example.com',
    ignoreRegisteredTag: false,
  }]);
});

test('findBaseAccountByAlias resolves generated alias back to original account', () => {
  const accounts = [{
    address: 'target@outlook.com',
    baseAddress: 'target@outlook.com',
    tags: [],
  }];
  const [aliasAccount] = expandHotmailAliasesForAccount(accounts[0]);

  const result = findBaseAccountByAlias(accounts, aliasAccount.address);
  assert.equal(result.address, 'target@outlook.com');
  assert.equal(result.requestedEmail, aliasAccount.address);
  assert.equal(result.resolvedEmail, 'target@outlook.com');
  assert.equal(result.matchedAlias, aliasAccount.address);
});
