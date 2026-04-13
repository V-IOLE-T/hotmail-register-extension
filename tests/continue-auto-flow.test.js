import test from 'node:test';
import assert from 'node:assert/strict';

import { continueSingleAutoFlow } from '../shared/auto-flow.js';

test('continueSingleAutoFlow starting from step 1 still executes step 2 before step 3', async () => {
  const calls = [];

  const result = await continueSingleAutoFlow({
    state: {
      stepStatuses: {
        1: 'pending',
        2: 'pending',
        3: 'pending',
        4: 'pending',
        5: 'pending',
        6: 'pending',
        7: 'pending',
        8: 'pending',
        9: 'pending',
      },
    },
    actions: {
      async addLog(message) {
        calls.push(`log:${message}`);
      },
      async refreshOauthFromVps() {
        calls.push('refreshOauthFromVps');
      },
      async findCurrentEmailRecord() {
        calls.push('findCurrentEmailRecord');
        return { id: 1, address: 'user@hotmail.com' };
      },
      async openOauthUrl() {
        calls.push('openOauthUrl');
      },
      async executeSignupStep(step) {
        calls.push(`executeSignupStep:${step}`);
      },
      async executeFinalVerifyStep() {
        calls.push('executeFinalVerifyStep');
      },
      async pollVerificationCode(phase) {
        calls.push(`pollVerificationCode:${phase}`);
        return { code: phase === 'signup' ? '123456' : '654321' };
      },
      async fillLastCode(phase) {
        calls.push(`fillLastCode:${phase}`);
      },
      async completeCurrentAccount() {
        calls.push('completeCurrentAccount');
        return { status: 'completed' };
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'log:继续自动流程：从步骤 1 开始',
    'log:阶段 1：刷新 CPA 并重新获取 OAuth 链接',
    'refreshOauthFromVps',
    'findCurrentEmailRecord',
    'log:阶段 2：打开认证页面并进入注册流程',
    'openOauthUrl',
    'executeSignupStep:2',
    'executeSignupStep:3',
    'pollVerificationCode:signup',
    'fillLastCode:signup',
    'executeSignupStep:5',
    'executeSignupStep:6',
    'pollVerificationCode:login',
    'fillLastCode:login',
    'executeSignupStep:8',
    'executeFinalVerifyStep',
    'completeCurrentAccount',
    'log:自动流程继续完成，当前邮箱已标记为已使用',
  ]);
});

test('continueSingleAutoFlow resumes from failed signup polling step', async () => {
  const calls = [];

  const result = await continueSingleAutoFlow({
    state: {
      stepStatuses: {
        1: 'completed',
        2: 'completed',
        3: 'completed',
        4: 'failed',
        5: 'pending',
        6: 'pending',
        7: 'pending',
        8: 'pending',
        9: 'pending',
      },
    },
    actions: {
      async addLog(message) {
        calls.push(`log:${message}`);
      },
      async pollVerificationCode(phase) {
        calls.push(`pollVerificationCode:${phase}`);
        return { code: '123456' };
      },
      async fillLastCode(phase) {
        calls.push(`fillLastCode:${phase}`);
      },
      async executeSignupStep(step) {
        calls.push(`executeSignupStep:${step}`);
        if (step === 6) {
          return { needsOTP: false };
        }
      },
      async executeFinalVerifyStep() {
        calls.push('executeFinalVerifyStep');
      },
      async completeCurrentAccount() {
        calls.push('completeCurrentAccount');
        return { status: 'completed' };
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'log:继续自动流程：从步骤 4 开始',
    'pollVerificationCode:signup',
    'fillLastCode:signup',
    'executeSignupStep:5',
    'executeSignupStep:6',
    'log:步骤 6：已通过密码登录，跳过登录验证码阶段',
    'executeSignupStep:8',
    'executeFinalVerifyStep',
    'completeCurrentAccount',
    'log:自动流程继续完成，当前邮箱已标记为已使用',
  ]);
});

test('continueSingleAutoFlow resumes from interrupted login step instead of restarting from step 1', async () => {
  const calls = [];

  const result = await continueSingleAutoFlow({
    state: {
      stepStatuses: {
        1: 'completed',
        2: 'completed',
        3: 'completed',
        4: 'completed',
        5: 'completed',
        6: 'running',
        7: 'pending',
        8: 'pending',
        9: 'pending',
      },
    },
    actions: {
      async addLog(message) {
        calls.push(`log:${message}`);
      },
      async executeSignupStep(step) {
        calls.push(`executeSignupStep:${step}`);
        if (step === 6) {
          return { needsOTP: true };
        }
      },
      async pollVerificationCode(phase) {
        calls.push(`pollVerificationCode:${phase}`);
        return { code: '654321' };
      },
      async fillLastCode(phase) {
        calls.push(`fillLastCode:${phase}`);
      },
      async executeFinalVerifyStep() {
        calls.push('executeFinalVerifyStep');
      },
      async completeCurrentAccount() {
        calls.push('completeCurrentAccount');
        return { status: 'completed' };
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'log:继续自动流程：从步骤 6 开始',
    'executeSignupStep:6',
    'pollVerificationCode:login',
    'fillLastCode:login',
    'executeSignupStep:8',
    'executeFinalVerifyStep',
    'completeCurrentAccount',
    'log:自动流程继续完成，当前邮箱已标记为已使用',
  ]);
});

test('continueSingleAutoFlow respects manually advanced step statuses after a failed earlier step', async () => {
  const calls = [];

  const result = await continueSingleAutoFlow({
    state: {
      stepStatuses: {
        1: 'completed',
        2: 'completed',
        3: 'failed',
        4: 'completed',
        5: 'pending',
        6: 'pending',
        7: 'pending',
        8: 'pending',
        9: 'pending',
      },
    },
    actions: {
      async addLog(message) {
        calls.push(`log:${message}`);
      },
      async executeSignupStep(step) {
        calls.push(`executeSignupStep:${step}`);
        if (step === 6) {
          return { needsOTP: false };
        }
      },
      async pollVerificationCode(phase) {
        calls.push(`pollVerificationCode:${phase}`);
        return { code: '123456' };
      },
      async fillLastCode(phase) {
        calls.push(`fillLastCode:${phase}`);
      },
      async executeFinalVerifyStep() {
        calls.push('executeFinalVerifyStep');
      },
      async completeCurrentAccount() {
        calls.push('completeCurrentAccount');
        return { status: 'completed' };
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [
    'log:继续自动流程：从步骤 5 开始',
    'executeSignupStep:5',
    'executeSignupStep:6',
    'log:步骤 6：已通过密码登录，跳过登录验证码阶段',
    'executeSignupStep:8',
    'executeFinalVerifyStep',
    'completeCurrentAccount',
    'log:自动流程继续完成，当前邮箱已标记为已使用',
  ]);
});
