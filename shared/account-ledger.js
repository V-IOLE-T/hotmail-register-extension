function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
}

function hasRegisteredTag(account, tagName = '已注册') {
  if (account?.ignoreRegisteredTag) {
    return false;
  }
  return Array.isArray(account?.tags)
    && account.tags.some((tag) => tag?.name === tagName);
}

function isAvailableAccount(account, ledger = {}, tagName = '已注册') {
  const address = normalizeAddress(account?.address);
  if (!address) {
    return false;
  }

  const status = getAccountStatus(ledger, address)?.status;
  return status !== 'completed' && !hasRegisteredTag(account, tagName);
}

function matchesAccountQuery(account, query) {
  const normalizedQuery = normalizeAddress(query);
  if (!normalizedQuery) {
    return true;
  }

  const haystacks = [
    account?.address,
    ...(Array.isArray(account?.aliases) ? account.aliases : []),
    account?.provider,
    account?.groupName,
  ]
    .map((value) => normalizeAddress(value))
    .filter(Boolean);

  return haystacks.some((value) => value.includes(normalizedQuery));
}

export function getAccountStatus(ledger = {}, address) {
  return ledger[normalizeAddress(address)] || null;
}

export function markAccountStatus(ledger = {}, address, status, extra = {}) {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) {
    throw new Error('邮箱地址不能为空');
  }

  return {
    ...ledger,
    [normalizedAddress]: {
      status,
      updatedAt: new Date().toISOString(),
      ...extra,
    },
  };
}

export function findNextAvailableAccount(accounts = [], ledger = {}, startIndex = 0) {
  for (let index = Math.max(0, startIndex); index < accounts.length; index += 1) {
    const account = accounts[index];
    const status = getAccountStatus(ledger, account?.address)?.status;
    if (status !== 'completed') {
      return { account, index };
    }
  }
  return null;
}

export function resolveCurrentAccountSelection({
  accounts = [],
  ledger = {},
  startIndex = 0,
  tagName = '已注册',
} = {}) {
  const normalizedStartIndex = Math.max(0, Number(startIndex) || 0);
  const scanFrom = (fromIndex) => {
    for (let index = fromIndex; index < accounts.length; index += 1) {
      const account = accounts[index];
      if (!isAvailableAccount(account, ledger, tagName)) {
        continue;
      }
      return {
        account,
        index,
      };
    }
    return null;
  };

  const primaryMatch = scanFrom(normalizedStartIndex);
  if (primaryMatch) {
    return primaryMatch;
  }

  if (normalizedStartIndex > 0) {
    return scanFrom(0);
  }

  return null;
}

export function summarizeAccountAvailability(accounts = [], ledger = {}, tagName = '已注册') {
  return accounts.reduce((summary, account) => {
    const status = getAccountStatus(ledger, account?.address)?.status;
    const taggedRegistered = hasRegisteredTag(account, tagName);

    summary.total += 1;
    if (status === 'completed') {
      summary.completedInLedger += 1;
      return summary;
    }
    if (taggedRegistered) {
      summary.taggedRegistered += 1;
      return summary;
    }
    summary.available += 1;
    return summary;
  }, {
    total: 0,
    completedInLedger: 0,
    taggedRegistered: 0,
    available: 0,
  });
}

export function listSkippedAccounts(accounts = [], ledger = {}, tagName = '已注册') {
  return accounts.reduce((result, account) => {
    const address = normalizeAddress(account?.address);
    const status = getAccountStatus(ledger, address)?.status;
    const taggedRegistered = hasRegisteredTag(account, tagName);

    if (status === 'completed' && address) {
      result.completedInLedger.push(address);
      return result;
    }

    if (taggedRegistered && address) {
      result.taggedRegistered.push(address);
    }

    return result;
  }, {
    completedInLedger: [],
    taggedRegistered: [],
  });
}

export function findAvailableAccountByAddress(accounts = [], ledger = {}, address, tagName = '已注册') {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) {
    return null;
  }

  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    if (!isAvailableAccount(account, ledger, tagName)) {
      continue;
    }

    const aliases = Array.isArray(account?.aliases) ? account.aliases.map((item) => normalizeAddress(item)) : [];
    if (normalizeAddress(account?.address) === normalizedAddress || aliases.includes(normalizedAddress)) {
      return { account, index };
    }
  }

  return null;
}

export function listAvailableAccounts(accounts = [], ledger = {}, {
  query = '',
  limit = 20,
  tagName = '已注册',
} = {}) {
  return accounts
    .filter((account) => isAvailableAccount(account, ledger, tagName))
    .filter((account) => matchesAccountQuery(account, query))
    .slice(0, Math.max(1, Number(limit) || 20));
}
