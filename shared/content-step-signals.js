export function createContentStepSignalRegistry() {
  const waiters = new Map();

  function clearWaiter(step) {
    const waiter = waiters.get(step);
    if (!waiter) return null;
    clearTimeout(waiter.timer);
    waiters.delete(step);
    return waiter;
  }

  function waitForStep(step, timeoutMs = 30000) {
    clearWaiter(step);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(step);
        reject(new Error(`等待页面内步骤 ${step} 完成超时，已超过 ${Math.round(timeoutMs / 1000)} 秒。`));
      }, timeoutMs);
      waiters.set(step, { resolve, reject, timer });
    });
  }

  function resolveStep(step, payload) {
    const waiter = clearWaiter(step);
    if (!waiter) return false;
    waiter.resolve(payload);
    return true;
  }

  function rejectStep(step, error) {
    const waiter = clearWaiter(step);
    if (!waiter) return false;
    waiter.reject(error);
    return true;
  }

  return {
    rejectStep,
    resolveStep,
    waitForStep,
  };
}

export function settleStepWaiterFromDispatchResult(registry, step, dispatchResult) {
  if (!registry || !dispatchResult) {
    return false;
  }

  if (dispatchResult.error || dispatchResult.ok === false) {
    return registry.rejectStep(step, new Error(dispatchResult.error || `页面内步骤 ${step} 执行失败`));
  }

  if (dispatchResult.ok) {
    return registry.resolveStep(step, dispatchResult);
  }

  return false;
}
