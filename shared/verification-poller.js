function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

const CODE_KEYWORD_PATTERNS = [
  /(?:验证码|校验码|动态码|确认码|安全码)[:\s：]*(\d{4,8})\b/i,
  /(?:verification\s*code|security\s*code|confirmation\s*code|one[\s-]*time\s*(?:code|password)|otp)[:\s：]*(\d{4,8})\b/i,
  /\b(code|pin)[:\s：]+(\d{4,8})\b/i,
  /(\d{4,8})\s*(?:is\s*your\s*(?:verification|confirmation|security)?\s*code)/i,
  /(?:您的?(?:验证码|校验码)是?[:\s：]*)(\d{4,8})/i,
  /(?:use\s*(?:code|this\s*code)[:\s：]*)(\d{4,8})\b/i,
];

const FALLBACK_CODE_PATTERN = /\b(\d{4,8})\b/;

function extractVerificationCode(text) {
  const str = String(text || '');
  for (const pattern of CODE_KEYWORD_PATTERNS) {
    const match = str.match(pattern);
    if (match) {
      const code = match[1] || match[2];
      if (code && /^\d{4,8}$/.test(code)) {
        return code;
      }
    }
  }
  const fallback = str.match(FALLBACK_CODE_PATTERN);
  return fallback ? fallback[1] : '';
}

function buildMailCodeText(mail = {}) {
  return `${mail.subject || ''} ${mail.bodyText || ''} ${mail.bodyHtml || ''}`.trim();
}

function matchesMail(mail, match = {}) {
  const keyword = String(match.keyword || '').trim().toLowerCase();
  const fromIncludes = String(match.fromIncludes || '').trim().toLowerCase();
  const subjectContains = String(match.subjectContains || '').trim().toLowerCase();

  const subject = String(mail.subject || '').toLowerCase();
  const from = String(mail.from || '').toLowerCase();
  const preview = String(mail.bodyText || '').toLowerCase();
  const haystack = `${subject} ${from} ${preview}`;

  if (subjectContains && !subject.includes(subjectContains)) {
    return false;
  }
  if (fromIncludes && !from.includes(fromIncludes)) {
    return false;
  }
  if (keyword && !haystack.includes(keyword)) {
    return false;
  }
  return true;
}

function selectFreshMail(mails, minReceivedAt, match, freshnessGraceMs = 0) {
  const minTimestamp = parseTimestamp(minReceivedAt);
  return mails.find((mail) => {
    if (!matchesMail(mail, match)) {
      return false;
    }
    const receivedAt = parseTimestamp(mail.receivedAt);
    if (!minTimestamp) {
      return true;
    }
    return receivedAt >= Math.max(0, minTimestamp - Math.max(0, Number(freshnessGraceMs) || 0));
  }) || null;
}

export async function pollVerificationCode({
  client,
  detailFetcher = null,
  email,
  mailboxContext = {},
  intervalMs = 3000,
  timeoutMs = 30000,
  minReceivedAt = '',
  freshnessGraceMs = 0,
  shouldContinue = null,
  match = {},
  addLog = async () => {},
  step = null,
  round = 1,
  maxRounds = 1,
  phaseLabel = '验证码',
} = {}) {
  if (!client?.listUserEmailMails) {
    throw new Error('邮件平台客户端缺少 listUserEmailMails 接口');
  }
  if (!email) {
    throw new Error('缺少邮箱地址，无法轮询验证码');
  }

  async function tryExtractCodeFromMail(mail, resolvedEmail) {
    const previewCode = extractVerificationCode(buildMailCodeText(mail));
    if (previewCode) {
      return {
        code: previewCode,
        mail,
        extractedFromDetail: false,
      };
    }

    if (!detailFetcher?.getEmailDetail || !mail?.messageId) {
      return null;
    }

    try {
      const detail = await detailFetcher.getEmailDetail(resolvedEmail || email, mail.messageId, {
        folder: mail.folder || 'inbox',
        isTemp: Boolean(mailboxContext?.isTemp),
      });
      const detailCode = extractVerificationCode(`${detail.subject || ''} ${detail.bodyText || ''} ${detail.body || ''}`);
      if (!detailCode) {
        return null;
      }
      return {
        code: detailCode,
        mail: {
          ...mail,
          bodyText: detail.bodyText || mail.bodyText || '',
          bodyHtml: detail.body || mail.bodyHtml || '',
        },
        extractedFromDetail: true,
      };
    } catch {
      return null;
    }
  }

  const deadline = Date.now() + timeoutMs;
  let latestMatchingMail = null;
  let latestMatchingResolvedEmail = '';
  let latestMatchingAlias = '';
  let attempt = 0;
  while (Date.now() <= deadline) {
    attempt += 1;
    if (typeof shouldContinue === 'function') {
      await shouldContinue();
    }
    const result = await client.listUserEmailMails(email, {
      folder: 'all',
      top: 10,
      skip: 0,
      subjectContains: match.subjectContains,
      fromContains: match.fromIncludes,
      keyword: match.keyword,
      isTemp: Boolean(mailboxContext?.isTemp),
    });
    const matchingMails = (result.emails || []).filter((mail) => matchesMail(mail, match));
    if (matchingMails.length > 0) {
      latestMatchingMail = matchingMails[0];
      latestMatchingResolvedEmail = result.resolvedEmail || email;
      latestMatchingAlias = result.matchedAlias || '';
    }
    const newestMail = selectFreshMail(result.emails || [], minReceivedAt, match, freshnessGraceMs);
    const remainSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

    if (newestMail) {
      await addLog(`步骤 ${step}：第 ${round}/${maxRounds} 轮第 ${attempt} 次检查发现新${phaseLabel}邮件，正在提取验证码...`, 'info');
      const extracted = await tryExtractCodeFromMail(newestMail, result.resolvedEmail || email);
      if (extracted?.code) {
        if (extracted.extractedFromDetail) {
          await addLog(`步骤 ${step}：已从邮件详情中提取到${phaseLabel}。`, 'info');
        }
        return {
          code: extracted.code,
          mail: extracted.mail,
          receivedAt: newestMail.receivedAt || '',
          resolvedEmail: result.resolvedEmail || email,
          matchedAlias: result.matchedAlias || '',
          extractedFromDetail: extracted.extractedFromDetail,
          usedOlderMatch: false,
          tags: [],
        };
      }
      await addLog(`步骤 ${step}：检测到新${phaseLabel}邮件，但暂未提取出验证码，继续等待下一次检查。`, 'warn');
    } else if (latestMatchingMail) {
      const aliasText = latestMatchingAlias ? `，当前命中别名 ${latestMatchingAlias}` : '';
      await addLog(`步骤 ${step}：第 ${round}/${maxRounds} 轮第 ${attempt} 次检查暂未发现更新的${phaseLabel}邮件，已有较早匹配邮件${aliasText}，距超时约 ${remainSeconds} 秒。`, 'info');
    } else {
      await addLog(`步骤 ${step}：第 ${round}/${maxRounds} 轮第 ${attempt} 次检查暂未发现匹配的${phaseLabel}邮件，距超时约 ${remainSeconds} 秒。`, 'info');
    }

    if (typeof shouldContinue === 'function') {
      await shouldContinue();
    }
    await sleep(intervalMs);
  }

  if (latestMatchingMail) {
    await addLog(`步骤 ${step}：本轮超时前未等到更新邮件，正在回退解析最近一封匹配的较早${phaseLabel}邮件...`, 'warn');
    const extracted = await tryExtractCodeFromMail(latestMatchingMail, latestMatchingResolvedEmail || email);
    if (extracted?.code) {
      if (extracted.extractedFromDetail) {
        await addLog(`步骤 ${step}：已从较早邮件详情中提取到${phaseLabel}。`, 'info');
      }
      return {
        code: extracted.code,
        mail: extracted.mail,
        receivedAt: latestMatchingMail.receivedAt || '',
        resolvedEmail: latestMatchingResolvedEmail || email,
        matchedAlias: latestMatchingAlias || '',
        extractedFromDetail: extracted.extractedFromDetail,
        usedOlderMatch: true,
        tags: [],
      };
    }
  }

  throw new Error(`轮询超时，未获取到验证码。邮箱=${email}`);
}
