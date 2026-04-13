import test from 'node:test';
import assert from 'node:assert/strict';

import { createInternalSessionClient } from '../shared/internal-session-client.js';

test('markAccountRegistered creates the tag when it does not exist and then assigns it', async () => {
  const requests = [];
  const responses = [
    { ok: true, payload: { csrf_token: 'csrf-1' } },
    { ok: true, payload: { success: true, tags: [] } },
    { ok: true, payload: { success: true, tag: { id: 8, name: '已注册' } } },
    { ok: true, payload: { success: true, updated_count: 1 } },
  ];

  const client = createInternalSessionClient({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async (url, options = {}) => {
      requests.push({
        url,
        method: options.method || 'GET',
        body: options.body ? JSON.parse(options.body) : null,
      });
      const next = responses.shift();
      return {
        ok: next.ok,
        status: next.ok ? 200 : 500,
        async json() {
          return next.payload;
        },
      };
    },
  });

  const result = await client.markAccountRegistered({
    accountId: 101,
    tagName: '已注册',
  });

  assert.deepEqual(result, { tagId: 8, created: true });
  assert.deepEqual(requests, [
    { url: 'http://localhost:5000/api/csrf-token', method: 'GET', body: null },
    { url: 'http://localhost:5000/api/tags', method: 'GET', body: null },
    { url: 'http://localhost:5000/api/tags', method: 'POST', body: { name: '已注册', color: '#16a34a' } },
    { url: 'http://localhost:5000/api/accounts/tags', method: 'POST', body: { account_ids: [101], tag_id: 8, action: 'add' } },
  ]);
});

test('getEmailDetail fetches internal email detail with encoded path params', async () => {
  const requests = [];
  const client = createInternalSessionClient({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async (url, options = {}) => {
      requests.push({
        url,
        method: options.method || 'GET',
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            email: {
              id: 'm1',
              subject: 'OpenAI verification code',
              body: '<div>Code 123456</div>',
              body_type: 'html',
            },
          };
        },
      };
    },
  });

  const detail = await client.getEmailDetail('user@hotmail.com', 'm1/abc', {
    folder: 'junkemail',
    method: 'graph',
  });

  assert.equal(detail.id, 'm1');
  assert.equal(detail.body, '<div>Code 123456</div>');
  assert.equal(detail.bodyType, 'html');
  assert.deepEqual(requests, [
    {
      url: 'http://localhost:5000/api/email/user%40hotmail.com/m1%2Fabc?folder=junkemail&method=graph',
      method: 'GET',
    },
  ]);
});

test('listTempEmails and temp email detail endpoints use encoded temp email paths', async () => {
  const requests = [];
  const responses = [
    {
      ok: true,
      status: 200,
      payload: {
        success: true,
        temp_emails: [{ email: 'demo@temp.example', provider: 'duckmail' }],
      },
    },
    {
      ok: true,
      status: 200,
      payload: {
        success: true,
        emails: [{ id: 'tm1', subject: 'Code', body_preview: '123456' }],
      },
    },
    {
      ok: true,
      status: 200,
      payload: {
        success: true,
        message: { id: 'tm1', body_text: 'Your code is 123456' },
      },
    },
  ];

  const client = createInternalSessionClient({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async (url, options = {}) => {
      requests.push({
        url,
        method: options.method || 'GET',
      });
      const next = responses.shift();
      return {
        ok: next.ok,
        status: next.status,
        async json() {
          return next.payload;
        },
      };
    },
  });

  const tempEmails = await client.listTempEmails();
  const messages = await client.listTempEmailMessages('demo@temp.example');
  const detail = await client.getTempEmailDetail('demo@temp.example', 'tm/1');

  assert.equal(tempEmails.length, 1);
  assert.equal(messages.length, 1);
  assert.equal(detail.id, 'tm1');
  assert.deepEqual(requests, [
    { url: 'http://localhost:5000/api/temp-emails', method: 'GET' },
    { url: 'http://localhost:5000/api/temp-emails/demo%40temp.example/messages', method: 'GET' },
    { url: 'http://localhost:5000/api/temp-emails/demo%40temp.example/messages/tm%2F1', method: 'GET' },
  ]);
});

test('createInternalSessionClient exposes the request url when fetch fails', async () => {
  const client = createInternalSessionClient({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });

  await assert.rejects(
    () => client.getCsrfToken(),
    /无法连接内部接口：http:\/\/localhost:5000\/api\/csrf-token/
  );
});

test('listTempEmails exposes login-required errors from internal session api', async () => {
  const client = createInternalSessionClient({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          success: false,
          error: '请先登录',
          need_login: true,
        };
      },
    }),
  });

  await assert.rejects(
    async () => client.listTempEmails(),
    (error) => {
      assert.equal(error.message, '请先登录');
      assert.equal(error.needLogin, true);
      assert.equal(error.code, 'INTERNAL_SESSION_LOGIN_REQUIRED');
      return true;
    }
  );
});
