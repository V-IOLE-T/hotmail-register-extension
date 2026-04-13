import test from 'node:test';
import assert from 'node:assert/strict';

import { pollVerificationCode } from '../shared/verification-poller.js';

test('pollVerificationCode extracts code from external email preview', async () => {
  let polled = 0;
  const logs = [];

  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails(email) {
        polled += 1;
        assert.equal(email, 'user@hotmail.com');
        if (polled < 2) {
          return { emails: [] };
        }
        return {
          resolvedEmail: 'user@hotmail.com',
          matchedAlias: '',
          emails: [
            {
              messageId: 'm1',
              subject: 'OpenAI verification code',
              bodyText: 'Your code is 482910',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T18:00:00Z',
            },
          ],
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 80,
    addLog: async (message) => {
      logs.push(message);
    },
    step: 4,
    round: 1,
    maxRounds: 2,
    phaseLabel: '注册验证码',
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(result.code, '482910');
  assert.equal(result.mail.messageId, 'm1');
  assert.equal(logs.some((message) => message.includes('第 1/2 轮第 1 次检查暂未发现匹配的注册验证码邮件')), true);
  assert.equal(logs.some((message) => message.includes('发现新注册验证码邮件，正在提取验证码')), true);
});

test('pollVerificationCode fails when email is missing', async () => {
  await assert.rejects(
    () => pollVerificationCode({
      client: {
        async listUserEmailMails() {
          return { emails: [] };
        },
      },
      timeoutMs: 10,
    }),
    /缺少邮箱地址/
  );
});

test('pollVerificationCode respects sender and keyword filters', async () => {
  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          emails: [
            {
              messageId: 'm1',
              subject: 'Spam code',
              bodyText: '111111',
              from: 'spam@example.com',
              receivedAt: '2026-04-12T18:00:00Z',
            },
            {
              messageId: 'm2',
              subject: 'OpenAI verification code',
              bodyText: 'Use code 222222',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T18:01:00Z',
            },
          ],
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 20,
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(result.code, '222222');
  assert.equal(result.mail.messageId, 'm2');
});

test('pollVerificationCode falls back to the latest matching older mail when no fresh mail arrives', async () => {
  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          resolvedEmail: 'user@hotmail.com',
          emails: [
            {
              messageId: 'm1',
              subject: 'OpenAI verification code',
              bodyText: 'Use code 333444',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T17:59:00Z',
            },
          ],
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 5,
    minReceivedAt: '2026-04-12T18:00:00Z',
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(result.code, '333444');
  assert.equal(result.mail.messageId, 'm1');
  assert.equal(result.usedOlderMatch, true);
});

test('pollVerificationCode accepts a recent matching mail slightly earlier than minReceivedAt', async () => {
  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          resolvedEmail: 'user@hotmail.com',
          emails: [
            {
              messageId: 'm2',
              subject: 'OpenAI verification code',
              bodyText: 'Use code 444555',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T17:59:55Z',
            },
          ],
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 20,
    minReceivedAt: '2026-04-12T18:00:00Z',
    freshnessGraceMs: 10000,
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(result.code, '444555');
  assert.equal(result.mail.messageId, 'm2');
  assert.equal(result.usedOlderMatch, false);
});

test('pollVerificationCode fetches message detail when preview does not contain the code', async () => {
  let detailRequested = 0;

  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails() {
        return {
          resolvedEmail: 'user@hotmail.com',
          emails: [
            {
              messageId: 'm9',
              subject: 'OpenAI verification code',
              bodyText: 'Click to continue',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T18:02:00Z',
              folder: 'inbox',
            },
          ],
        };
      },
    },
    detailFetcher: {
      async getEmailDetail(email, messageId, options = {}) {
        detailRequested += 1;
        assert.equal(email, 'user@hotmail.com');
        assert.equal(messageId, 'm9');
        assert.equal(options.folder, 'inbox');
        return {
          body: '<div>Your code is <b>555666</b></div>',
          bodyText: 'Your code is 555666',
        };
      },
    },
    email: 'user@hotmail.com',
    intervalMs: 1,
    timeoutMs: 10,
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(detailRequested, 1);
  assert.equal(result.code, '555666');
  assert.equal(result.mail.messageId, 'm9');
  assert.equal(result.extractedFromDetail, true);
});

test('pollVerificationCode forwards temp mailbox context to list and detail fetchers', async () => {
  const result = await pollVerificationCode({
    client: {
      async listUserEmailMails(email, options = {}) {
        assert.equal(email, 'temp@cstea.shop');
        assert.equal(options.isTemp, true);
        return {
          resolvedEmail: 'temp@cstea.shop',
          emails: [
            {
              messageId: 'tm1',
              subject: 'OpenAI verification code',
              bodyText: 'Open mail body',
              from: 'noreply@openai.com',
              receivedAt: '2026-04-12T18:02:00Z',
              folder: 'inbox',
            },
          ],
        };
      },
    },
    detailFetcher: {
      async getEmailDetail(email, messageId, options = {}) {
        assert.equal(email, 'temp@cstea.shop');
        assert.equal(messageId, 'tm1');
        assert.equal(options.folder, 'inbox');
        assert.equal(options.isTemp, true);
        return {
          bodyText: 'Your code is 667788',
        };
      },
    },
    email: 'temp@cstea.shop',
    mailboxContext: {
      isTemp: true,
    },
    intervalMs: 1,
    timeoutMs: 10,
    match: {
      fromIncludes: 'openai.com',
      keyword: 'OpenAI',
      subjectContains: 'OpenAI',
    },
  });

  assert.equal(result.code, '667788');
});

test('pollVerificationCode times out with readable message', async () => {
  await assert.rejects(
    () => pollVerificationCode({
      client: {
        async listUserEmailMails() {
          return { emails: [] };
        },
      },
      email: 'user@hotmail.com',
      intervalMs: 1,
      timeoutMs: 10,
    }),
    /轮询超时/
  );
});
