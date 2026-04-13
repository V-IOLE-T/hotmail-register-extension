function buildUrl(baseUrl, pathname, query = {}) {
  const url = new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function buildApiError(payload, response) {
  const error = new Error(payload?.message || payload?.error || `内部接口请求失败 (${response.status})`);
  error.code = payload?.need_login ? 'INTERNAL_SESSION_LOGIN_REQUIRED' : 'INTERNAL_SESSION_REQUEST_FAILED';
  error.needLogin = Boolean(payload?.need_login);
  error.payload = payload || null;
  error.status = response.status;
  return error;
}

async function parseJsonResponse(response) {
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    throw buildApiError(payload, response);
  }
  return payload;
}

function buildFetchFailureMessage(url, error) {
  const reason = error?.message || String(error);
  return `无法连接内部接口：${url}。请确认 API URL 可访问、服务已启动，且浏览器当前登录态与证书状态正常。原始错误：${reason}`;
}

export function createInternalSessionClient({
  baseUrl,
  fetchImpl = fetch,
} = {}) {
  if (!baseUrl) {
    throw new Error('内部接口 Base URL 不能为空');
  }

  async function request(pathname, options = {}) {
    const url = buildUrl(baseUrl, pathname, options.query || {});
    let response;
    try {
      response = await fetchImpl(url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}),
          ...(options.headers || {}),
        },
        credentials: 'include',
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      throw new Error(buildFetchFailureMessage(url, error));
    }
    return parseJsonResponse(response);
  }

  async function getCsrfToken() {
    const payload = await request('/api/csrf-token');
    return payload.csrf_token || null;
  }

  async function listTags() {
    const payload = await request('/api/tags');
    return Array.isArray(payload.tags) ? payload.tags : [];
  }

  async function listTempEmails() {
    const payload = await request('/api/temp-emails');
    if (Array.isArray(payload.temp_emails)) return payload.temp_emails;
    if (Array.isArray(payload.emails)) return payload.emails;
    if (Array.isArray(payload.accounts)) return payload.accounts;
    return [];
  }

  async function listTempEmailMessages(email) {
    if (!email) {
      throw new Error('获取临时邮箱邮件列表缺少邮箱地址');
    }

    const encodedEmail = encodeURIComponent(email);
    const payload = await request(`/api/temp-emails/${encodedEmail}/messages`);
    return Array.isArray(payload.emails) ? payload.emails : [];
  }

  async function getTempEmailDetail(email, messageId) {
    if (!email) {
      throw new Error('获取临时邮箱详情缺少邮箱地址');
    }
    if (!messageId) {
      throw new Error('获取临时邮箱详情缺少 messageId');
    }

    const encodedEmail = encodeURIComponent(email);
    const encodedMessageId = encodeURIComponent(messageId);
    const payload = await request(`/api/temp-emails/${encodedEmail}/messages/${encodedMessageId}`);
    return payload.message || payload.email || payload.data || {};
  }

  async function createTag({ name, color = '#16a34a', csrfToken }) {
    const payload = await request('/api/tags', {
      method: 'POST',
      csrfToken,
      body: { name, color },
    });
    return payload.tag || null;
  }

  async function setAccountTag({ accountIds, tagId, action = 'add', csrfToken }) {
    return request('/api/accounts/tags', {
      method: 'POST',
      csrfToken,
      body: {
        account_ids: accountIds,
        tag_id: tagId,
        action,
      },
    });
  }

  async function getEmailDetail(email, messageId, {
    folder = 'inbox',
    method = 'graph',
  } = {}) {
    if (!email) {
      throw new Error('获取邮件详情缺少邮箱地址');
    }
    if (!messageId) {
      throw new Error('获取邮件详情缺少 messageId');
    }

    const encodedEmail = encodeURIComponent(email);
    const encodedMessageId = encodeURIComponent(messageId);
    const payload = await request(`/api/email/${encodedEmail}/${encodedMessageId}?folder=${encodeURIComponent(folder)}&method=${encodeURIComponent(method)}`);
    const emailPayload = payload.email || {};
    return {
      id: emailPayload.id || messageId,
      subject: emailPayload.subject || '',
      body: emailPayload.body || '',
      bodyText: emailPayload.body_text || emailPayload.body || '',
      bodyType: emailPayload.body_type || '',
      from: emailPayload.from || '',
      to: emailPayload.to || '',
      date: emailPayload.date || '',
    };
  }

  async function markAccountRegistered({ accountId, tagName = '已注册', tagColor = '#16a34a' }) {
    const csrfToken = await getCsrfToken();
    const tags = await listTags();
    let tag = tags.find((item) => item?.name === tagName) || null;
    let created = false;

    if (!tag) {
      tag = await createTag({ name: tagName, color: tagColor, csrfToken });
      created = true;
    }
    if (!tag?.id) {
      throw new Error(`无法创建或获取标签：${tagName}`);
    }

    await setAccountTag({
      accountIds: [accountId],
      tagId: tag.id,
      action: 'add',
      csrfToken,
    });

    return { tagId: tag.id, created };
  }

  return {
    getCsrfToken,
    listTags,
    listTempEmails,
    listTempEmailMessages,
    getTempEmailDetail,
    createTag,
    getEmailDetail,
    setAccountTag,
    markAccountRegistered,
  };
}
