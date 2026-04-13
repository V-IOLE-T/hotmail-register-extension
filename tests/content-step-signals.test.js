import test from 'node:test';
import assert from 'node:assert/strict';

import { createContentStepSignalRegistry, settleStepWaiterFromDispatchResult } from '../shared/content-step-signals.js';

test('content step signal registry resolves waiting step payload', async () => {
  const registry = createContentStepSignalRegistry();
  const waiter = registry.waitForStep(3, 1000);

  assert.equal(registry.resolveStep(3, { ok: true, step: 3 }), true);
  assert.deepEqual(await waiter, { ok: true, step: 3 });
});

test('content step signal registry rejects waiting step error', async () => {
  const registry = createContentStepSignalRegistry();
  const waiter = registry.waitForStep(2, 1000);
  const error = new Error('step failed');

  assert.equal(registry.rejectStep(2, error), true);
  await assert.rejects(waiter, /step failed/);
});

test('content step signal registry returns false when no waiter exists', () => {
  const registry = createContentStepSignalRegistry();
  assert.equal(registry.resolveStep(9, { ok: true }), false);
  assert.equal(registry.rejectStep(9, new Error('missing')), false);
});

test('settleStepWaiterFromDispatchResult resolves waiter when content script returns success directly', async () => {
  const registry = createContentStepSignalRegistry();
  const waiter = registry.waitForStep(2, 1000);

  assert.equal(
    settleStepWaiterFromDispatchResult(registry, 2, { ok: true, alreadyOnSignup: true }),
    true
  );
  assert.deepEqual(await waiter, { ok: true, alreadyOnSignup: true });
});
