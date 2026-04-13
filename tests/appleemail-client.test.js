import test from 'node:test';
import assert from 'node:assert/strict';

import { createAppleEmailClient } from '../shared/appleemail-client.js';

function createJsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

const APPLE_POOL_TEXT = [
  'target@outlook.com----mail-pass----cid-1----rt-1',
  'normal@example.com----mail-pass-2----cid-2----rt-2',
].join('\n');

test('listAccounts expands microsoft AppleEmail mailbox into five alias registration accounts', async () => {
  const client = createAppleEmailClient({
    baseUrl: 'https://apple.test',
    accountPoolText: APPLE_POOL_TEXT,
  });

  const accounts = await client.listAccounts();
  const microsoftAccounts = accounts.filter((account) => account.baseAddress === 'target@outlook.com');
  const normalAccount = accounts.find((account) => account.address === 'normal@example.com');

  assert.equal(microsoftAccounts.length, 5);
  microsoftAccounts.forEach((account, index) => {
    assert.equal(account.isAlias, true);
    assert.equal(account.aliasIndex, index);
    assert.equal(account.ignoreRegisteredTag, true);
    assert.match(account.address, /^target\+[A-Za-z0-9]{6}@outlook\.com$/);
  });
  assert.deepEqual(normalAccount, {
    id: 2,
    address: 'normal@example.com',
    password: 'mail-pass-2',
    clientId: 'cid-2',
    refreshToken: 'rt-2',
    aliases: [],
    tags: [],
    status: 'active',
    provider: 'appleemail',
    source: 'pool',
    isTemp: false,
    groupId: 0,
    groupName: '',
    requestedEmail: 'normal@example.com',
    resolvedEmail: 'normal@example.com',
    matchedAlias: '',
    baseAddress: 'normal@example.com',
    isAlias: false,
    aliasIndex: null,
    aliasSuffix: '',
    displayAddress: 'normal@example.com',
    ignoreRegisteredTag: false,
  });
});

test('findUserEmailByAddress resolves AppleEmail generated alias back to base account', async () => {
  const client = createAppleEmailClient({
    baseUrl: 'https://apple.test',
    accountPoolText: 'target@hotmail.com----mail-pass----cid-1----rt-1',
  });

  const accounts = await client.listAccounts();
  const aliasAccount = accounts.find((account) => account.isAlias);
  const record = await client.findUserEmailByAddress(aliasAccount.address);

  assert.equal(record.address, 'target@hotmail.com');
  assert.equal(record.baseAddress, 'target@hotmail.com');
  assert.equal(record.matchedAlias, aliasAccount.address);
  assert.equal(record.resolvedEmail, 'target@hotmail.com');
});

test('listUserEmailMails queries AppleEmail mailbox with base address when alias is provided', async () => {
  const requests = [];
  const client = createAppleEmailClient({
    baseUrl: 'https://apple.test',
    accountPoolText: 'target@outlook.com----mail-pass----cid-1----rt-1',
    fetchImpl: async (url) => {
      requests.push(url);
      return createJsonResponse({
        success: true,
        data: {
          total: 1,
          emails: [
            {
              id: 'm1',
              subject: 'Your verification code',
              text: 'Your code is 123456',
            },
          ],
        },
      });
    },
  });

  const aliasAccount = (await client.listAccounts()).find((account) => account.isAlias);
  const result = await client.listUserEmailMails(aliasAccount.address, { keyword: 'verification' });

  assert.equal(result.resolvedEmail, 'target@outlook.com');
  assert.equal(result.matchedAlias, aliasAccount.address);
  assert.equal(result.emails[0].messageId, 'm1');
  assert.match(requests[0], /email=target%40outlook\.com/);
  assert.match(requests[0], /keyword=verification/);
});

test('getEmailDetail queries AppleEmail mailbox with base address when alias is provided', async () => {
  const requests = [];
  const client = createAppleEmailClient({
    baseUrl: 'https://apple.test',
    accountPoolText: 'target@outlook.com----mail-pass----cid-1----rt-1',
    fetchImpl: async (url) => {
      requests.push(url);
      return createJsonResponse({
        success: true,
        data: {
          id: 'm1',
          text: 'Your code is 654321',
        },
      });
    },
  });

  const aliasAccount = (await client.listAccounts()).find((account) => account.isAlias);
  const detail = await client.getEmailDetail(aliasAccount.address, 'm1');

  assert.equal(detail.id, 'm1');
  assert.equal(detail.bodyText, 'Your code is 654321');
  assert.match(requests[0], /email=target%40outlook\.com/);
  assert.match(requests[0], /mail_id=m1/);
});
