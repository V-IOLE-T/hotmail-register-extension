function isAuthHostUrl(url) {
  try {
    const parsed = new URL(url);
    return ['auth0.openai.com', 'auth.openai.com', 'accounts.openai.com'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function chooseOauthTabCandidate({ currentTab = null, tabs = [], preferredTabId = null } = {}) {
  if (currentTab?.url && isAuthHostUrl(currentTab.url)) {
    return currentTab;
  }

  if (preferredTabId != null) {
    const preferredTab = tabs.find((tab) => tab?.id === preferredTabId && tab?.url && isAuthHostUrl(tab.url));
    if (preferredTab) {
      return preferredTab;
    }
  }

  return tabs.find((tab) => tab?.url && isAuthHostUrl(tab.url)) || null;
}

export function listAuthTabIds(tabs = []) {
  return tabs
    .filter((tab) => tab?.id && tab?.url && isAuthHostUrl(tab.url))
    .map((tab) => tab.id);
}

export { isAuthHostUrl };
