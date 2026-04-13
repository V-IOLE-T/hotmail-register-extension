export function buildPanelTabOpenPlan({
  existingTab,
  targetUrl,
  preserveExistingTab = false,
} = {}) {
  if (!targetUrl) {
    throw new Error('缺少面板地址');
  }

  if (!existingTab?.id) {
    return {
      action: 'create',
      tabId: null,
      waitForComplete: true,
      injectAfterLoad: false,
      url: targetUrl,
    };
  }

  if ((existingTab.url || '') === targetUrl) {
    if (!preserveExistingTab && existingTab.status === 'complete') {
      return {
        action: 'reload',
        tabId: existingTab.id,
        waitForComplete: true,
        injectAfterLoad: false,
        url: targetUrl,
      };
    }

    return {
      action: 'activate',
      tabId: existingTab.id,
      waitForComplete: existingTab.status !== 'complete',
      injectAfterLoad: false,
      url: targetUrl,
    };
  }

  if (preserveExistingTab) {
    return {
      action: 'activate',
      tabId: existingTab.id,
      waitForComplete: existingTab.status !== 'complete',
      injectAfterLoad: false,
      url: existingTab.url || targetUrl,
    };
  }

  return {
    action: 'update',
    tabId: existingTab.id,
    waitForComplete: true,
    injectAfterLoad: false,
    url: targetUrl,
  };
}
