import test from 'node:test';
import assert from 'node:assert/strict';

import { createLuckmailClient } from '../shared/luckmail-client.js';

function createJsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test('findUserEmailByAddress matches primary email', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => createJsonResponse({
      success: true,
      total: 1,
      accounts: [
        {
          id: 2,
          email: 'target@hotmail.com',
          aliases: ['alias@example.com'],
          tags: [{ id: 1, name: '核心' }],
        },
      ],
    }),
  });

  const record = await client.findUserEmailByAddress('target@hotmail.com');
  assert.equal(record.id, 2);
  assert.equal(record.address, 'target@hotmail.com');
  assert.equal(record.tags.length, 1);
});

test('findUserEmailByAddress matches alias email', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => createJsonResponse({
      success: true,
      total: 1,
      accounts: [
        {
          id: 2,
          email: 'target@hotmail.com',
          aliases: ['alias@example.com'],
        },
      ],
    }),
  });

  const record = await client.findUserEmailByAddress('alias@example.com');
  assert.equal(record.address, 'target@hotmail.com');
  assert.deepEqual(record.aliases, ['alias@example.com']);
});

test('listUserEmailMails normalizes external email list response', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => createJsonResponse({
      success: true,
      requested_email: 'alias@example.com',
      resolved_email: 'target@hotmail.com',
      matched_alias: 'alias@example.com',
      has_more: true,
      emails: [
        {
          id: 'm1',
          subject: 'Your verification code',
          from: 'no-reply@example.com',
          date: '2026-04-09T14:20:00Z',
          body_preview: 'Your code is 123456',
          folder: 'inbox',
        },
      ],
    }),
  });

  const result = await client.listUserEmailMails('alias@example.com', { folder: 'all' });
  assert.equal(result.resolvedEmail, 'target@hotmail.com');
  assert.equal(result.matchedAlias, 'alias@example.com');
  assert.equal(result.emails[0].messageId, 'm1');
  assert.equal(result.emails[0].bodyText, 'Your code is 123456');
});

test('createLuckmailClient throws a readable error when external API responds with failure', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => createJsonResponse({
      success: false,
      message: 'invalid api key',
    }),
  });

  await assert.rejects(
    () => client.listAccounts(),
    /invalid api key/
  );
});

test('createLuckmailClient exposes the request url when fetch fails', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });

  await assert.rejects(
    () => client.listAccounts(),
    /无法连接邮箱平台接口：http:\/\/localhost:5000\/api\/external\/accounts/
  );
});

test('findFirstUnregisteredAccount returns the first account without 已注册 tag', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => createJsonResponse({
      success: true,
      total: 2,
      accounts: [
        {
          id: 2,
          email: 'registered@hotmail.com',
          tags: [{ id: 8, name: '已注册' }],
        },
        {
          id: 3,
          email: 'fresh@hotmail.com',
          password: 'mail-pass',
          client_id: 'cid-3',
          refresh_token: 'rt-3',
          tags: [{ id: 2, name: '核心' }],
        },
      ],
    }),
  });

  const account = await client.findFirstUnregisteredAccount();
  assert.equal(account.address, 'fresh@hotmail.com');
  assert.equal(account.password, 'mail-pass');
  assert.equal(account.clientId, 'cid-3');
  assert.equal(account.refreshToken, 'rt-3');
});

test('findFirstUnregisteredAccount skips excluded addresses', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => createJsonResponse({
      success: true,
      total: 2,
      accounts: [
        {
          id: 3,
          email: 'fresh@hotmail.com',
          tags: [{ id: 2, name: '核心' }],
        },
        {
          id: 4,
          email: 'next@hotmail.com',
          tags: [],
        },
      ],
    }),
  });

  const account = await client.findFirstUnregisteredAccount({
    excludedAddresses: ['fresh@hotmail.com'],
  });
  assert.equal(account.address, 'next@hotmail.com');
});

test('findFirstUnregisteredAccount can skip multiple excluded addresses including current account', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => createJsonResponse({
      success: true,
      total: 3,
      accounts: [
        {
          id: 3,
          email: 'current@hotmail.com',
          tags: [],
        },
        {
          id: 4,
          email: 'completed@hotmail.com',
          tags: [],
        },
        {
          id: 5,
          email: 'next@hotmail.com',
          tags: [],
        },
      ],
    }),
  });

  const account = await client.findFirstUnregisteredAccount({
    excludedAddresses: ['current@hotmail.com', 'completed@hotmail.com'],
  });
  assert.equal(account.address, 'next@hotmail.com');
});

test('listAccounts merges temp emails from internal session client', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => createJsonResponse({
      success: true,
      total: 1,
      accounts: [
        {
          id: 3,
          email: 'normal@outlook.com',
          tags: [],
        },
      ],
    }),
    internalClient: {
      async listTempEmails() {
        return [
          {
            id: 11,
            email: 'temp@cstea.shop',
            provider: 'duckmail',
          },
        ];
      },
    },
  });

  const accounts = await client.listAccounts();
  assert.equal(accounts.length, 2);
  assert.deepEqual(accounts.map((item) => [item.address, item.source, item.isTemp]), [
    ['normal@outlook.com', 'external', false],
    ['temp@cstea.shop', 'temp', true],
  ]);
});

test('listAccounts preserves temp email login-required status when internal session is not logged in', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => createJsonResponse({
      success: true,
      total: 1,
      accounts: [
        {
          id: 3,
          email: 'normal@outlook.com',
          tags: [],
        },
      ],
    }),
    internalClient: {
      async listTempEmails() {
        const error = new Error('请先登录');
        error.needLogin = true;
        error.code = 'INTERNAL_SESSION_LOGIN_REQUIRED';
        throw error;
      },
    },
  });

  const accounts = await client.listAccounts();
  assert.equal(accounts.length, 1);
  assert.deepEqual(client.getTempEmailStatus(), {
    available: false,
    needLogin: true,
    message: '请先登录',
  });
});

test('listUserEmailMails routes temp emails to internal temp mailbox endpoints', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => {
      throw new Error('external endpoint should not be used');
    },
    internalClient: {
      async listTempEmails() {
        return [
          { email: 'temp@cstea.shop', provider: 'duckmail' },
        ];
      },
      async listTempEmailMessages(email) {
        assert.equal(email, 'temp@cstea.shop');
        return [
          {
            id: 'tm1',
            subject: 'OpenAI verification code',
            body_preview: 'Your code is 123456',
            from: 'noreply@openai.com',
            date: '2026-04-13T04:00:00Z',
          },
        ];
      },
    },
  });

  const result = await client.listUserEmailMails('temp@cstea.shop');
  assert.equal(result.resolvedEmail, 'temp@cstea.shop');
  assert.equal(result.emails[0].messageId, 'tm1');
  assert.equal(result.emails[0].bodyText, 'Your code is 123456');
});

test('listUserEmailMails does not fall back to external api when temp context is explicit and session is missing', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => {
      throw new Error('external endpoint should not be used');
    },
    internalClient: {
      async listTempEmailMessages() {
        const error = new Error('请先登录');
        error.needLogin = true;
        error.code = 'INTERNAL_SESSION_LOGIN_REQUIRED';
        throw error;
      },
    },
  });

  await assert.rejects(
    () => client.listUserEmailMails('temp@cstea.shop', { isTemp: true }),
    (error) => {
      assert.equal(error.message, '请先登录');
      assert.equal(error.needLogin, true);
      return true;
    }
  );
});

test('getEmailDetail routes temp emails to internal temp email detail endpoint', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => {
      throw new Error('external endpoint should not be used');
    },
    internalClient: {
      async listTempEmails() {
        return [
          { email: 'temp@cstea.shop', provider: 'duckmail' },
        ];
      },
      async getTempEmailDetail(email, messageId) {
        assert.equal(email, 'temp@cstea.shop');
        assert.equal(messageId, 'tm1');
        return {
          id: 'tm1',
          body_text: 'Your code is 789012',
        };
      },
    },
  });

  const detail = await client.getEmailDetail('temp@cstea.shop', 'tm1');
  assert.equal(detail.id, 'tm1');
  assert.equal(detail.bodyText, 'Your code is 789012');
});

test('getEmailDetail does not fall back to normal detail api when temp context is explicit and session is missing', async () => {
  const client = createLuckmailClient({
    apiKey: 'test-key',
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => {
      throw new Error('external endpoint should not be used');
    },
    internalClient: {
      async getTempEmailDetail() {
        const error = new Error('请先登录');
        error.needLogin = true;
        error.code = 'INTERNAL_SESSION_LOGIN_REQUIRED';
        throw error;
      },
      async getEmailDetail() {
        throw new Error('normal detail api should not be used');
      },
    },
  });

  await assert.rejects(
    () => client.getEmailDetail('temp@cstea.shop', 'tm1', { isTemp: true }),
    (error) => {
      assert.equal(error.message, '请先登录');
      assert.equal(error.needLogin, true);
      return true;
    }
  );
});
