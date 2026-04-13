const ALIAS_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ALIAS_COUNT = 5;
const HOTMAIL_ALIAS_DOMAINS = new Set([
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
]);

function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
}

function splitAddress(address) {
  const normalized = normalizeAddress(address);
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return null;
  }
  return {
    localPart: normalized.slice(0, atIndex),
    domain: normalized.slice(atIndex + 1),
  };
}

function shouldEnableHotmailAliases(address) {
  const parts = splitAddress(address);
  return Boolean(parts && HOTMAIL_ALIAS_DOMAINS.has(parts.domain));
}

function hashString(input) {
  let hash = 2166136261;
  const text = String(input || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildStableAliasSuffix(address, aliasIndex, length = 6) {
  let seed = hashString(`${normalizeAddress(address)}#${aliasIndex}`);
  let result = '';
  for (let index = 0; index < length; index += 1) {
    seed = Math.imul(seed ^ (index + 1), 2246822519) >>> 0;
    result += ALIAS_CHARSET[seed % ALIAS_CHARSET.length];
  }
  return result;
}

function createAliasAddress(baseAddress, aliasSuffix) {
  const parts = splitAddress(baseAddress);
  if (!parts) {
    return normalizeAddress(baseAddress);
  }
  return normalizeAddress(`${parts.localPart}+${aliasSuffix}@${parts.domain}`);
}

export function expandHotmailAliasesForAccount(account = {}, { aliasCount = ALIAS_COUNT } = {}) {
  const baseAddress = normalizeAddress(account.baseAddress || account.address);
  if (!shouldEnableHotmailAliases(baseAddress)) {
    return [{
      ...account,
      address: baseAddress,
      baseAddress,
      isAlias: false,
      aliasIndex: null,
      aliasSuffix: '',
      displayAddress: baseAddress,
      aliases: Array.isArray(account.aliases) ? [...account.aliases] : [],
      ignoreRegisteredTag: false,
    }];
  }

  const originalAliases = Array.isArray(account.aliases)
    ? account.aliases.map((item) => normalizeAddress(item)).filter(Boolean)
    : [];
  const expanded = [];
  const usedAddresses = new Set();

  for (let aliasIndex = 0; aliasIndex < Math.max(1, Number(aliasCount) || ALIAS_COUNT); aliasIndex += 1) {
    let suffix = buildStableAliasSuffix(baseAddress, aliasIndex);
    let aliasAddress = createAliasAddress(baseAddress, suffix);
    let collisionSalt = 0;
    while (usedAddresses.has(aliasAddress)) {
      collisionSalt += 1;
      suffix = buildStableAliasSuffix(`${baseAddress}:${collisionSalt}`, aliasIndex);
      aliasAddress = createAliasAddress(baseAddress, suffix);
    }
    usedAddresses.add(aliasAddress);

    expanded.push({
      ...account,
      address: aliasAddress,
      baseAddress,
      isAlias: true,
      aliasIndex,
      aliasSuffix: suffix,
      displayAddress: aliasAddress,
      aliases: [baseAddress, ...originalAliases],
      ignoreRegisteredTag: true,
    });
  }

  return expanded;
}

export function findBaseAccountByAlias(accounts = [], address) {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) {
    return null;
  }

  for (const account of accounts) {
    const baseAddress = normalizeAddress(account?.baseAddress || account?.address);
    if (!baseAddress) {
      continue;
    }
    if (baseAddress === normalizedAddress) {
      return account;
    }
    if (!shouldEnableHotmailAliases(baseAddress)) {
      continue;
    }
    for (let aliasIndex = 0; aliasIndex < ALIAS_COUNT; aliasIndex += 1) {
      const aliasSuffix = buildStableAliasSuffix(baseAddress, aliasIndex);
      if (createAliasAddress(baseAddress, aliasSuffix) === normalizedAddress) {
        return {
          ...account,
          requestedEmail: normalizedAddress,
          resolvedEmail: baseAddress,
          matchedAlias: normalizedAddress,
        };
      }
    }
  }

  return null;
}

export function getHotmailAliasCount() {
  return ALIAS_COUNT;
}
