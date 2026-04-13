import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPanelTabOpenPlan } from '../shared/panel-tab-plan.js';

test('buildPanelTabOpenPlan reloads existing tab on same url when refresh is required', () => {
  const plan = buildPanelTabOpenPlan({
    existingTab: {
      id: 7,
      url: 'http://127.0.0.1:3000/management.html#/oauth',
      status: 'complete',
    },
    targetUrl: 'http://127.0.0.1:3000/management.html#/oauth',
  });

  assert.deepEqual(plan, {
    action: 'reload',
    tabId: 7,
    waitForComplete: true,
    injectAfterLoad: false,
    url: 'http://127.0.0.1:3000/management.html#/oauth',
  });
});

test('buildPanelTabOpenPlan waits for load when existing tab is same url but not complete', () => {
  const plan = buildPanelTabOpenPlan({
    existingTab: {
      id: 7,
      url: 'http://127.0.0.1:3000/management.html#/oauth',
      status: 'loading',
    },
    targetUrl: 'http://127.0.0.1:3000/management.html#/oauth',
  });

  assert.deepEqual(plan, {
    action: 'activate',
    tabId: 7,
    waitForComplete: true,
    injectAfterLoad: false,
    url: 'http://127.0.0.1:3000/management.html#/oauth',
  });
});

test('buildPanelTabOpenPlan updates existing tab when target url changed', () => {
  const plan = buildPanelTabOpenPlan({
    existingTab: {
      id: 7,
      url: 'http://127.0.0.1:3000/management.html#/other',
      status: 'complete',
    },
    targetUrl: 'http://127.0.0.1:3000/management.html#/oauth',
  });

  assert.deepEqual(plan, {
    action: 'update',
    tabId: 7,
    waitForComplete: true,
    injectAfterLoad: false,
    url: 'http://127.0.0.1:3000/management.html#/oauth',
  });
});

test('buildPanelTabOpenPlan can preserve existing panel tab without refreshing url', () => {
  const plan = buildPanelTabOpenPlan({
    existingTab: {
      id: 7,
      url: 'http://127.0.0.1:3000/management.html#/dashboard',
      status: 'complete',
    },
    targetUrl: 'http://127.0.0.1:3000/management.html#/oauth',
    preserveExistingTab: true,
  });

  assert.deepEqual(plan, {
    action: 'activate',
    tabId: 7,
    waitForComplete: false,
    injectAfterLoad: false,
    url: 'http://127.0.0.1:3000/management.html#/dashboard',
  });
});

test('buildPanelTabOpenPlan creates a new tab when none exists', () => {
  const plan = buildPanelTabOpenPlan({
    existingTab: null,
    targetUrl: 'http://127.0.0.1:3000/management.html#/oauth',
  });

  assert.deepEqual(plan, {
    action: 'create',
    tabId: null,
    waitForComplete: true,
    injectAfterLoad: false,
    url: 'http://127.0.0.1:3000/management.html#/oauth',
  });
});
