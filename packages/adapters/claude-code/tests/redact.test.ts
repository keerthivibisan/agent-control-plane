import { describe, expect, it } from 'vitest';
import { cleanFreeText } from '../src/redact.js';

describe('cleanFreeText (core redact + cleanup)', () => {
  it('redacts secrets using the core rules', () => {
    const text = 'deploy with sk-ant-api03-abcdefghijklmnop and ghp_abcdefghijklmnopqrstuvwx now';
    expect(cleanFreeText(text, 200)).toBe('deploy with [REDACTED] and [REDACTED] now');
  });

  it('collapses whitespace and control characters', () => {
    expect(cleanFreeText('  a\n\tb\u0000  c  ', 200)).toBe('a b c');
  });

  it('returns null when nothing is left', () => {
    expect(cleanFreeText(' \n\t ', 200)).toBeNull();
    expect(cleanFreeText('', 200)).toBeNull();
  });

  it('caps by code points without splitting a surrogate pair', () => {
    expect(cleanFreeText('😀'.repeat(10), 3)).toBe('😀😀😀');
  });

  it('redacts before capping, so a cut cannot expose a partial key', () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    const out = cleanFreeText(`xxxxx ${key}`, 12);
    expect(out).not.toContain('sk-ant');
    expect(out).not.toContain('abcdef');
  });
});
