const DEFAULT_BASE_URL = 'https://www.appleemail.top';

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
    throw new Error(payload?.message || `AppleEmail 请求失败 (${response.status})`);
  }
  return payload;
}

function buildFetchFailureMessage(url, error) {
  const reason = error?.message || String(error);
  return `无法连接 AppleEmail 接口：${url}。请确认 API URL 可访问、服务已启动，且当前网络未拦截请求。原始错误：${reason}`;
}

function normalizeMail(mail = {}) {
  return {
    messageId: mail.id || mail.mail_id || mail.message_id || '',
    from: mail.from || mail.sender || '',
    to: mail.to || mail.receiver || '',
    subject: mail.subject || mail.title || '',
    bodyText: mail.text || mail.body_text || mail.body_preview || mail.body || '',
    bodyHtml: mail.html || mail.body_html || mail.body || '',
    receivedAt: mail.date || mail.received_at || mail.created_at || '',
    folder: mail.mailbox || mail.folder || '',
  };
}

export function createAppleEmailClient({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  accountPoolText = '',
} = {}) {
  if (!baseUrl) {
    throw new Error('AppleEmail Base URL 不能为空');
  }

  // Store accountPoolText internally so callers don't need to pass it through
  let _accountPoolText = accountPoolText;

  function setAccountPoolText(text) {
    _accountPoolText = text;
  }

  function getAccountPoolText() {
    return _accountPoolText;
  }

  async function request(pathname, query = {}, options = {}) {
    const url = buildUrl(baseUrl, pathname, query);
    let response;
    try {
      response = await fetchImpl(url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      throw new Error(buildFetchFailureMessage(url, error));
    }
    return parseJsonResponse(response);
  }

  function buildAuthParams(account = {}) {
    return {
      refresh_token: account.refreshToken || account.refresh_token || '',
      client_id: account.clientId || account.client_id || '',
    };
  }

  async function listAccounts() {
    const lines = String(_accountPoolText || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.map((line, index) => {
      const parts = line.split('----').map((p) => p.trim());
      if (parts.length !== 4 || parts.some((p) => !p)) {
        return null;
      }
      return {
        id: index + 1,
        address: parts[0].toLowerCase(),
        password: parts[1],
        clientId: parts[2],
        refreshToken: parts[3],
        aliases: [],
        tags: [],
        status: 'active',
        provider: 'appleemail',
        source: 'pool',
        isTemp: false,
        groupId: 0,
        groupName: '',
        requestedEmail: parts[0],
        resolvedEmail: parts[0],
        matchedAlias: '',
      };
    }).filter(Boolean);
  }

  async function findUserEmailByAddress(address) {
    const normalizedAddress = String(address || '').trim().toLowerCase();
    const accounts = await listAccounts();
    return accounts.find((account) => account.address === normalizedAddress) || null;
  }

  async function findFirstUnregisteredAccount({
    excludedAddresses = [],
  } = {}) {
    const accounts = await listAccounts();
    const blockedAddresses = new Set(
      excludedAddresses.map((item) => String(item || '').trim().toLowerCase()),
    );
    return accounts.find((account) => !blockedAddresses.has(account.address)) || null;
  }

  async function listUserEmailMails(email, {
    folder = 'INBOX',
    top = 10,
    skip = 0,
    keyword = '',
    isTemp = false,
  } = {}) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const account = await findUserEmailByAddress(normalizedEmail);
    if (!account) {
      return {
        emails: [],
        partial: false,
        details: null,
        requestedEmail: email,
        resolvedEmail: normalizedEmail,
        matchedAlias: '',
        hasMore: false,
      };
    }

    const authParams = buildAuthParams(account);
    const page = Math.floor(skip / Math.max(1, top)) + 1;
    const pageSize = Math.min(top, 50);

    let payload;
    if (keyword) {
      payload = await request('/api/mail-search', {
        ...authParams,
        email: normalizedEmail,
        keyword,
        page,
        page_size: pageSize,
        response_type: 'json',
      });
    } else {
      payload = await request('/api/mail-all', {
        ...authParams,
        email: normalizedEmail,
        mailbox: folder === 'Junk' ? 'Junk' : 'INBOX',
        page,
        page_size: pageSize,
        response_type: 'json',
      });
    }

    const rawEmails = Array.isArray(payload.data) ? payload.data
      : Array.isArray(payload.data?.emails) ? payload.data.emails
      : Array.isArray(payload.data?.list) ? payload.data.list
      : [];

    const emails = rawEmails.map(normalizeMail);
    const total = payload.data?.total || payload.total || 0;
    const hasMore = total > skip + emails.length;

    return {
      emails,
      partial: false,
      details: null,
      requestedEmail: email,
      resolvedEmail: normalizedEmail,
      matchedAlias: '',
      hasMore,
    };
  }

  async function getEmailDetail(email, messageId, options = {}) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const account = await findUserEmailByAddress(normalizedEmail);
    if (!account) {
      throw new Error(`AppleEmail 账号池中未找到邮箱：${normalizedEmail}`);
    }

    const authParams = buildAuthParams(account);
    const payload = await request('/api/mail-detail', {
      ...authParams,
      email: normalizedEmail,
      mail_id: messageId,
      response_type: 'json',
    });

    const detail = payload.data || payload;
    return {
      id: detail.id || detail.mail_id || messageId,
      subject: detail.subject || detail.title || '',
      body: detail.html || detail.body_html || detail.body || '',
      bodyText: detail.text || detail.body_text || detail.body || '',
      bodyType: detail.html ? 'html' : 'text',
      from: detail.from || detail.sender || '',
      to: detail.to || detail.receiver || '',
      date: detail.date || detail.received_at || detail.created_at || '',
    };
  }

  return {
    setAccountPoolText,
    getAccountPoolText,
    listAccounts,
    findUserEmailByAddress,
    findFirstUnregisteredAccount,
    listUserEmailMails,
    getEmailDetail,
    importEmails: async () => ({
      skipped: true,
      message: 'AppleEmail 不支持在插件内导入邮箱。',
    }),
    getTempEmailStatus: () => ({ available: false, needLogin: false, message: '' }),
  };
}
