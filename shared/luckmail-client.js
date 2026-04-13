const DEFAULT_BASE_URL = 'http://localhost:5000';

function buildUrl(baseUrl, pathname, query = {}) {
  const url = new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parseJsonResponse(response) {
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || `邮件平台请求失败 (${response.status})`);
  }
  return payload;
}

function buildFetchFailureMessage(url, error) {
  const reason = error?.message || String(error);
  return `无法连接邮箱平台接口：${url}。请确认 API URL 可访问、服务已启动，且当前证书/网络未拦截请求。原始错误：${reason}`;
}

function normalizeAccount(account = {}) {
  return {
    id: account.id || 0,
    address: String(account.email || '').trim().toLowerCase(),
    baseAddress: String(account.email || '').trim().toLowerCase(),
    aliases: Array.isArray(account.aliases) ? account.aliases.map((item) => String(item || '').trim().toLowerCase()) : [],
    password: account.password || account.mail_password || account.login_password || '',
    clientId: account.client_id || account.clientId || '',
    refreshToken: account.refresh_token || account.refreshToken || '',
    groupId: account.group_id || 0,
    groupName: account.group_name || '',
    tags: Array.isArray(account.tags) ? account.tags : [],
    status: account.status || '',
    provider: account.provider || '',
    source: 'external',
    isTemp: false,
    requestedEmail: account.requested_email || '',
    resolvedEmail: account.resolved_email || account.email || '',
    matchedAlias: account.matched_alias || '',
    isAlias: false,
    aliasIndex: null,
    aliasSuffix: '',
    displayAddress: String(account.email || '').trim().toLowerCase(),
    ignoreRegisteredTag: false,
  };
}

function normalizeTempAccount(account = {}) {
  return {
    id: account.id || account.temp_id || 0,
    address: String(account.email || account.email_addr || account.address || '').trim().toLowerCase(),
    baseAddress: String(account.email || account.email_addr || account.address || '').trim().toLowerCase(),
    aliases: [],
    password: account.password || account.mail_password || account.login_password || account.jwt || '',
    clientId: '',
    refreshToken: '',
    groupId: account.group_id || 0,
    groupName: account.group_name || '',
    tags: Array.isArray(account.tags) ? account.tags : [],
    status: account.status || 'active',
    provider: account.provider || account.channel || account.account_type || '',
    source: 'temp',
    isTemp: true,
    requestedEmail: account.requested_email || account.email || account.email_addr || '',
    resolvedEmail: account.resolved_email || account.email || account.email_addr || account.address || '',
    matchedAlias: '',
    isAlias: false,
    aliasIndex: null,
    aliasSuffix: '',
    displayAddress: String(account.email || account.email_addr || account.address || '').trim().toLowerCase(),
    ignoreRegisteredTag: false,
  };
}

function normalizeMail(mail = {}) {
  return {
    messageId: mail.id || mail.message_id || '',
    from: mail.from || '',
    to: mail.to || '',
    subject: mail.subject || '',
    bodyText: mail.body_preview || mail.body_text || '',
    bodyHtml: mail.mail_body_html || mail.body_html || '',
    receivedAt: mail.date || mail.received_at || '',
    folder: mail.folder || '',
  };
}

export function createLuckmailClient({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  internalClient = null,
} = {}) {
  if (!apiKey) {
    throw new Error('邮件平台 API Key 不能为空');
  }
  if (!baseUrl) {
    throw new Error('邮件平台 Base URL 不能为空');
  }

  let tempEmailStatus = {
    available: true,
    needLogin: false,
    message: '',
  };

  function resetTempEmailStatus() {
    tempEmailStatus = {
      available: true,
      needLogin: false,
      message: '',
    };
  }

  function setTempEmailErrorStatus(error) {
    tempEmailStatus = {
      available: false,
      needLogin: Boolean(error?.needLogin),
      message: error?.message || String(error),
    };
  }

  async function listTempAccounts() {
    resetTempEmailStatus();
    if (!internalClient?.listTempEmails) {
      return [];
    }

    try {
      return (await internalClient.listTempEmails()).map(normalizeTempAccount);
    } catch (error) {
      setTempEmailErrorStatus(error);
      return [];
    }
  }

  async function request(pathname, query, options = {}) {
    const url = buildUrl(baseUrl, pathname, query);
    let response;
    try {
      response = await fetchImpl(url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      throw new Error(buildFetchFailureMessage(url, error));
    }
    return parseJsonResponse(response);
  }

  async function listAccounts({ groupId } = {}) {
    const payload = await request('/api/external/accounts', {
      group_id: groupId,
    });
    const externalAccounts = (Array.isArray(payload.accounts) ? payload.accounts : [])
      .map(normalizeAccount);
    const tempAccounts = await listTempAccounts();
    return [...externalAccounts, ...tempAccounts].filter((account) => account.address);
  }

  async function findUserEmailByAddress(address, options = {}) {
    const normalizedAddress = String(address || '').trim().toLowerCase();
    const payload = await request('/api/external/accounts', {
      group_id: options.groupId,
    });
    const externalAccounts = (Array.isArray(payload.accounts) ? payload.accounts : []).map(normalizeAccount);
    const directExternalMatch = externalAccounts.find((account) => (
      account.address === normalizedAddress
      || account.aliases.includes(normalizedAddress)
    ));
    if (directExternalMatch) {
      return directExternalMatch;
    }

    const tempAccounts = await listTempAccounts();
    return tempAccounts.find((account) => account.address === normalizedAddress) || null;
  }

  async function findFirstUnregisteredAccount({
    tagName = '已注册',
    excludeStatuses = [],
    excludedAddresses = [],
    groupId,
  } = {}) {
    const accounts = await listAccounts({ groupId });
    const blockedStatuses = new Set(excludeStatuses);
    const blockedAddresses = new Set(excludedAddresses.map((item) => String(item || '').trim().toLowerCase()));
    return accounts.find((account) => {
      const hasRegisteredTag = !account.ignoreRegisteredTag
        && account.tags.some((tag) => tag?.name === tagName);
      const isBlocked = blockedStatuses.has(account.status);
      const isExcludedAddress = blockedAddresses.has(account.address);
      return !hasRegisteredTag && !isBlocked && !isExcludedAddress;
    }) || null;
  }

  async function importEmails() {
    return {
      skipped: true,
      message: '当前平台不需要在插件内导入邮箱，请在平台后台管理邮箱池。',
    };
  }

  async function listUserEmailMails(email, {
    folder = 'all',
    top = 10,
    skip = 0,
    subjectContains = '',
    fromContains = '',
    keyword = '',
    isTemp = false,
  } = {}) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (isTemp && internalClient?.listTempEmailMessages) {
      const emails = await internalClient.listTempEmailMessages(normalizedEmail);
      return {
        emails: emails.map(normalizeMail),
        partial: false,
        details: null,
        requestedEmail: email,
        resolvedEmail: normalizedEmail,
        matchedAlias: '',
        hasMore: false,
      };
    }

    if (internalClient?.listTempEmails && internalClient?.listTempEmailMessages) {
      const tempAccounts = await listTempAccounts();
      const matchedTempAccount = tempAccounts
        .find((account) => account.address === normalizedEmail);
      if (matchedTempAccount) {
        const emails = await internalClient.listTempEmailMessages(matchedTempAccount.address);
        return {
          emails: emails.map(normalizeMail),
          partial: false,
          details: null,
          requestedEmail: email,
          resolvedEmail: matchedTempAccount.address,
          matchedAlias: '',
          hasMore: false,
        };
      }
    }

    const payload = await request('/api/external/emails', {
      email,
      folder,
      top,
      skip,
      subject_contains: subjectContains,
      from_contains: fromContains,
      keyword,
    });
    const emails = Array.isArray(payload.emails) ? payload.emails : [];
    return {
      emails: emails.map(normalizeMail),
      partial: Boolean(payload.partial),
      details: payload.details || null,
      requestedEmail: payload.requested_email || email,
      resolvedEmail: payload.resolved_email || email,
      matchedAlias: payload.matched_alias || '',
      hasMore: Boolean(payload.has_more),
    };
  }

  async function getEmailDetail(email, messageId, options = {}) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (options?.isTemp && internalClient?.getTempEmailDetail) {
      const detail = await internalClient.getTempEmailDetail(normalizedEmail, messageId);
      return {
        id: detail.id || detail.message_id || messageId,
        subject: detail.subject || '',
        body: detail.body || detail.html || detail.body_html || '',
        bodyText: detail.body_text || detail.body_preview || detail.text || detail.body || '',
        bodyType: detail.body_type || '',
        from: detail.from || '',
        to: detail.to || '',
        date: detail.date || detail.received_at || '',
      };
    }

    if (internalClient?.listTempEmails && internalClient?.getTempEmailDetail) {
      const tempAccounts = await listTempAccounts();
      const matchedTempAccount = tempAccounts
        .find((account) => account.address === normalizedEmail);
      if (matchedTempAccount) {
        const detail = await internalClient.getTempEmailDetail(matchedTempAccount.address, messageId);
        return {
          id: detail.id || detail.message_id || messageId,
          subject: detail.subject || '',
          body: detail.body || detail.html || detail.body_html || '',
          bodyText: detail.body_text || detail.body_preview || detail.text || detail.body || '',
          bodyType: detail.body_type || '',
          from: detail.from || '',
          to: detail.to || '',
          date: detail.date || detail.received_at || '',
        };
      }
    }

    if (!internalClient?.getEmailDetail) {
      throw new Error('邮件平台客户端缺少 getEmailDetail 接口');
    }

    return internalClient.getEmailDetail(email, messageId, options);
  }

  return {
    importEmails,
    findFirstUnregisteredAccount,
    listAccounts,
    findUserEmailByAddress,
    listUserEmailMails,
    getEmailDetail,
    getTempEmailStatus: () => ({ ...tempEmailStatus }),
  };
}
