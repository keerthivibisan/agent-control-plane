import { describe, expect, it } from 'vitest';
import { tokenize } from '../../../src/components/diff/highlight';
import type { SyntaxLang } from '../../../src/components/diff/language';

/*
 * The real Shiki, as the browser loads it: the bundled grammars and the JavaScript regex engine,
 * no network and no WASM. Token colors are the CSS-variables theme's `var(--shiki-…)`.
 */
describe('tokenize (real Shiki)', () => {
  it('highlights TypeScript line by line with CSS-variable colors', async () => {
    const lines = await tokenize(
      'const pageSize = 50; // cap\nexport function f() {}',
      'typescript',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]?.map((t) => t.content).join('')).toBe('const pageSize = 50; // cap');
    const color = (text: string) => lines.flat().find((t) => t.content.trim() === text)?.color;
    expect(color('const')).toBe('var(--shiki-token-keyword)');
    expect(color('50')).toBe('var(--shiki-token-constant)');
    expect(color('f')).toBe('var(--shiki-token-function)');
    const comment = lines[0]?.find((t) => t.content.includes('cap'));
    expect(comment?.color).toBe('var(--shiki-token-comment)');
  });

  it('loads every language of the bounded set', async () => {
    const samples: Record<SyntaxLang, string> = {
      typescript: 'let a: number = 1;',
      tsx: 'const A = () => <div className="x" />;',
      javascript: 'let a = 1;',
      jsx: 'const A = () => <div />;',
      json: '{ "a": 1 }',
      markdown: 'Use `npm test` and [docs](x.md)',
      css: '.a { color: red; }',
      html: '<p class="a">x</p>',
      python: 'def f(x):\n    return x',
      java: 'public class A { }',
      go: 'func main() {}',
      rust: 'fn main() {}',
      yaml: 'a: 1',
      shellscript: 'echo "$HOME"',
      sql: 'SELECT * FROM t;',
      kotlin: 'fun main() {}',
      swift: 'let a = 1',
      c: 'int main(void) { return 0; }',
      cpp: 'int main() { return 0; }',
      ruby: 'def f; end',
      php: '<?php echo 1;',
    };
    for (const [lang, code] of Object.entries(samples) as [SyntaxLang, string][]) {
      const lines = await tokenize(code, lang);
      expect(lines.map((l) => l.map((t) => t.content).join('')).join('\n'), lang).toBe(code);
      expect(
        lines.flat().some((t) => t.color?.startsWith('var(--shiki-token-') === true),
        lang,
      ).toBe(true);
    }
  }, 30_000);
});
