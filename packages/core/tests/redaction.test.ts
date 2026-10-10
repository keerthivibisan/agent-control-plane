import { describe, expect, it } from 'vitest';
import { REDACTED, REDACTION_RULE_NAMES, redact } from '../src/index.js';

// Fake secrets are assembled at runtime so no secret-shaped literal sits in the repository.
const fake = (prefix: string, body: string) => `${prefix}${body}`;
const B62 = 'aB3dE5fG7hJ9kL1mN2pQ4rS6tU8vW0xY';

const ANTHROPIC = fake('sk-ant-', `api03-${B62}${B62}`);
const OPENAI = fake('sk-', `proj-${B62}`);
const GHP = fake('ghp_', `${B62}1234`);
const GHO = fake('gho_', `${B62}1234`);
const GH_PAT = fake('github_pat_', `11ABCDEFG0_${B62}`);
const SLACK = fake('xoxb-', '1234567890-0987654321-abcDEF');
const AWS = fake('AKIA', 'IOSFODNN7EXAMPLE');
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl0';
const PEM = [
  fake('-----BEGIN ', 'RSA PRIVATE KEY-----'),
  'MIIEowIBAAKCAQEAplaceholderplaceholder',
  'placeholderplaceholderplaceholder==',
  fake('-----END ', 'RSA PRIVATE KEY-----'),
].join('\n');

describe('redact (security §2.4, A7)', () => {
  describe('positive cases: each pattern is removed', () => {
    it.each([
      ['Anthropic key', `key is ${ANTHROPIC} ok`, `key is ${REDACTED} ok`],
      ['generic sk- key', `OPENAI=${OPENAI}`, `OPENAI=${REDACTED}`],
      ['GitHub ghp_ token', `push with ${GHP}`, `push with ${REDACTED}`],
      ['GitHub gho_ token', `(${GHO})`, `(${REDACTED})`],
      ['GitHub fine-grained PAT', `pat ${GH_PAT}.`, `pat ${REDACTED}.`],
      ['Slack token', `slack ${SLACK} end`, `slack ${REDACTED} end`],
      ['AWS access key id', `aws ${AWS}`, `aws ${REDACTED}`],
      ['Bearer token', `curl -H x Bearer ${JWT} done`, `curl -H x Bearer ${REDACTED} done`],
      ['lower-case bearer', `bearer ${JWT}`, `bearer ${REDACTED}`],
      ['Authorization header', `Authorization: Basic dXNlcjpwYXNz`, `Authorization: ${REDACTED}`],
      ['JSON Authorization', `{"Authorization": "Token abc"}`, `{"Authorization": ${REDACTED}`],
      [
        'password query value',
        `https://h/x?user=u&password=hunter2&y=1`,
        `https://h/x?user=u&password=${REDACTED}&y=1`,
      ],
      ['token query value', `?token=abc123#frag`, `?token=${REDACTED}#frag`],
      [
        'prefixed token key',
        `access_token=abc refresh_token=def`,
        `access_token=${REDACTED} refresh_token=${REDACTED}`,
      ],
      ['api key value', `api_key=abc&apikey=def`, `api_key=${REDACTED}&apikey=${REDACTED}`],
    ])('%s', (_name, input, expected) => {
      expect(redact(input)).toBe(expected);
    });

    it('private key block, including surrounding text', () => {
      expect(redact(`before\n${PEM}\nafter`)).toBe(`before\n${REDACTED}\nafter`);
    });

    it('unterminated private key block (truncated text) up to the end', () => {
      const truncated = PEM.slice(0, 60);
      expect(redact(`title: ${truncated}`)).toBe(`title: ${REDACTED}`);
    });

    it('several secrets in one line', () => {
      const out = redact(`a ${GHP} b ${AWS} c ${ANTHROPIC}`);
      expect(out).toBe(`a ${REDACTED} b ${REDACTED} c ${REDACTED}`);
    });

    it('authorization header redacts the bearer value inside it', () => {
      const out = redact(`Authorization: Bearer ${JWT}\nnext line`);
      expect(out).toBe(`Authorization: ${REDACTED}\nnext line`);
      expect(out).not.toContain(JWT);
    });
  });

  describe('negative cases: ordinary text is left alone', () => {
    it.each([
      ['words ending in sk-', 'task-runner and risk-assessment-for-the-q3-plan-2026'],
      ['short sk- names', 'install sk-learn today'],
      ['sk- prose without digits', 'sk-the-quick-brown-fox-jumps-over'],
      ['gh prefixes without a token', 'ghp_short and gho_ and the github_pat_ docs'],
      ['xox without a token', 'xoxb- is the Slack bot prefix'],
      ['AKIA-like but too short', 'AKIA123'],
      ['AKIA-like but too long', 'AKIAIOSFODNN7EXAMPLEXTRA'],
      ['bearer in prose', 'Bearer of bad news; bearer tokens are described in RFC 6750'],
      ['authorization without a colon', 'Authorization required before deploy'],
      ['token counts', 'max_tokens=4096 tokens=12 token_count=3 tokenizer=bpe'],
      ['password without a value', 'password reset flow and password= alone'],
      [
        'public key block',
        fake('-----BEGIN ', 'PUBLIC KEY-----\nMIIBIjAN\n-----END PUBLIC KEY-----'),
      ],
      ['plain session title', 'Fix login bug in packages/web (issue #42)'],
      ['empty string', ''],
    ])('%s', (_name, input) => {
      expect(redact(input)).toBe(input);
    });
  });

  it('is idempotent', () => {
    const inputs = [
      `Authorization: Bearer ${JWT}`,
      `x ${GHP} ?password=p&token=t`,
      `${PEM}`,
      `Bearer ${JWT}`,
    ];
    for (const input of inputs) {
      const once = redact(input);
      expect(redact(once)).toBe(once);
    }
  });

  it('covers every pattern family required by the spec', () => {
    expect(REDACTION_RULE_NAMES).toEqual([
      'private-key-block',
      'authorization-header',
      'bearer-token',
      'anthropic-key',
      'sk-key',
      'github-token',
      'slack-token',
      'aws-access-key-id',
      'secret-query-value',
    ]);
  });
});
