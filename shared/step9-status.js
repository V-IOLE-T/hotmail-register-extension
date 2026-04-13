const SUCCESS_PATTERN = /认证成功|authentication\s+successful|authenticated\s+successfully|success(?:!|$|\b)/i;
const TIMEOUT_PATTERN = /认证失败:\s*Timeout waiting for OAuth callback/i;
const PENDING_CONFLICT_PATTERN = /oauth\s+flow\s+is\s+not\s+pending|flow\s+is\s+not\s+pending/i;

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function findMatchingText(candidates = [], pattern) {
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (normalized && pattern.test(normalized)) {
      return normalized;
    }
  }
  return '';
}

export function getStep9StatusOutcome({
  texts = [],
  now = 0,
  pendingConflictSeenAt = 0,
  pendingConflictGraceMs = 4000,
} = {}) {
  const successText = findMatchingText(texts, SUCCESS_PATTERN);
  if (successText) {
    return { kind: 'success', text: successText };
  }

  const timeoutText = findMatchingText(texts, TIMEOUT_PATTERN);
  if (timeoutText) {
    return { kind: 'oauth_timeout', text: timeoutText };
  }

  const pendingConflictText = findMatchingText(texts, PENDING_CONFLICT_PATTERN);
  if (!pendingConflictText) {
    return { kind: 'waiting', text: '' };
  }

  if (!pendingConflictSeenAt || (now - pendingConflictSeenAt) < pendingConflictGraceMs) {
    return { kind: 'pending_conflict_wait', text: pendingConflictText };
  }

  return { kind: 'pending_conflict_timeout', text: pendingConflictText };
}
