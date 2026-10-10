/** Replacement for every redacted secret. Contains no part of the original value. */
export const REDACTED = '[REDACTED]';

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * Secret patterns from docs/security.md §2.4. Order matters: broader rules (whole key blocks, whole
 * header lines) run before token rules, and `sk-ant-` runs before the generic `sk-`.
 *
 * Token rules use a "not preceded by an alphanumeric" lookbehind instead of `\b`, so a prefix glued
 * to a word (`task-…`, `disk-…`) is not mistaken for a key. Where a prefix is common in prose
 * (`sk-`, `Bearer`), the token must also contain a digit and be long, which real keys always are.
 * Over-redaction is preferred to leaking: these run on titles, descriptions, and log lines only.
 */
const RULES: readonly RedactionRule[] = [
  {
    // A truncated (capped) title may cut the END line, so an unterminated block runs to the end.
    name: 'private-key-block',
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|[\s\S]*$)/g,
    replacement: REDACTED,
  },
  {
    name: 'authorization-header',
    pattern: /\b((?:proxy-)?authorization["']?[ \t]*:[ \t]*)[^\s][^\r\n]*/gi,
    replacement: `$1${REDACTED}`,
  },
  {
    name: 'bearer-token',
    pattern: /\b(bearer)[ \t]+(?=[A-Za-z0-9._~+/-]*\d)[A-Za-z0-9._~+/-]{16,}=*/gi,
    replacement: `$1 ${REDACTED}`,
  },
  {
    name: 'anthropic-key',
    pattern: /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{8,}/g,
    replacement: REDACTED,
  },
  {
    name: 'sk-key',
    pattern: /(?<![A-Za-z0-9])sk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g,
    replacement: REDACTED,
  },
  {
    name: 'github-token',
    pattern: /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
    replacement: REDACTED,
  },
  {
    name: 'slack-token',
    pattern: /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/g,
    replacement: REDACTED,
  },
  {
    name: 'aws-access-key-id',
    pattern: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/g,
    replacement: REDACTED,
  },
  {
    // `password=…`, `token=…`, `access_token=…`, `api_key=…` in URLs, query strings, and key=value text.
    name: 'secret-query-value',
    pattern:
      /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]*?(?:password|passwd|token|secret|api[_-]?key)=)[^\s&#"';,]+/gi,
    replacement: `$1${REDACTED}`,
  },
];

/** Names of the redaction rules, in application order (for diagnostics and docs). */
export const REDACTION_RULE_NAMES: readonly string[] = Object.freeze(RULES.map((r) => r.name));

/**
 * Removes credentials from free text before it is persisted or logged (docs/security.md §2.4).
 * Idempotent: redacting already-redacted text changes nothing.
 */
export function redact(text: string): string {
  let result = text;
  for (const rule of RULES) result = result.replace(rule.pattern, rule.replacement);
  return result;
}
