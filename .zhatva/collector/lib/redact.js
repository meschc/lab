const MASK = '[скрыто]';

const PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi,
  /\b-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Fa-f0-9]{48,}\b/g,
];

function redact(text) {
  if (typeof text !== 'string' || !text) return text;
  return PATTERNS.reduce((acc, pattern) => acc.replace(pattern, MASK), text);
}

module.exports = { redact, MASK };
