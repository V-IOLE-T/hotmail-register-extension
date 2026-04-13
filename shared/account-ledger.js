function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
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
      const status = getAccountStatus(ledger, account?.address)?.status;
      const hasRegisteredTag = Array.isArray(account?.tags)
        && account.tags.some((tag) => tag?.name === tagName);
      if (status === 'completed' || hasRegisteredTag) {
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
