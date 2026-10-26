import type { HighlighterCore, LanguageRegistration } from 'shiki/core';
import type { SyntaxLang } from './language';

/**
 * Syntax highlighting for the diff viewer with Shiki (ADR-0025 §6), loaded on demand: nothing
 * here is imported until a diff with a known language is opened, and every Shiki module comes in
 * through a dynamic `import()`, so Vite puts Shiki, its JavaScript regex engine and each grammar
 * in chunks of their own, served by the app itself. No network: no CDN, no WASM fetch (the
 * JavaScript engine needs none), and no theme files. The one theme is Shiki's CSS-variables
 * theme: token colors are `var(--shiki-…)`, defined for the light and dark tokens in `diff.css`,
 * so the colors follow the app theme without highlighting again.
 */

export interface SyntaxToken {
  content: string;
  /** A CSS color, here always a `var(--shiki-…)` reference; absent for plain text. */
  color?: string;
  italic?: boolean;
  bold?: boolean;
}

/** Tokens per line of the code given to `tokenize`. */
export type SyntaxLines = SyntaxToken[][];

type LangModule = { default: LanguageRegistration[] };

/** One loader per language: a literal `import()` each, so the build bundles only these. */
const LOADERS: Readonly<Record<SyntaxLang, () => Promise<LangModule>>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  php: () => import('shiki/langs/php.mjs'),
};

const THEME = 'acp-diff';
/** Longer lines are left plain: tokenizing a minified line costs more than it shows. */
const MAX_LINE_LENGTH = 1000;

let core: Promise<HighlighterCore> | null = null;
const languages = new Map<SyntaxLang, Promise<void>>();

function highlighter(): Promise<HighlighterCore> {
  core ??= (async () => {
    const [shiki, engine] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return shiki.createHighlighterCore({
      themes: [shiki.createCssVariablesTheme({ name: THEME, variablePrefix: '--shiki-' })],
      langs: [],
      // Forgiving: a pattern the JavaScript engine cannot run is skipped instead of failing.
      engine: engine.createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  // A failed load (a missing chunk after an update, say) may succeed on a later diff.
  core.catch(() => {
    core = null;
  });
  return core;
}

function loadLanguage(h: HighlighterCore, lang: SyntaxLang): Promise<void> {
  let loading = languages.get(lang);
  if (loading === undefined) {
    loading = LOADERS[lang]().then((m) => h.loadLanguage(...m.default));
    languages.set(lang, loading);
    loading.catch(() => languages.delete(lang));
  }
  return loading;
}

/** Highlights `code` as `lang`: one token list per line. Rejects when Shiki cannot load. */
export async function tokenize(code: string, lang: SyntaxLang): Promise<SyntaxLines> {
  const h = await highlighter();
  await loadLanguage(h, lang);
  const result = h.codeToTokens(code, {
    lang,
    theme: THEME,
    tokenizeMaxLineLength: MAX_LINE_LENGTH,
  });
  return result.tokens.map((line) =>
    line.map((t) => {
      const token: SyntaxToken = { content: t.content };
      if (t.color !== undefined) token.color = t.color;
      // Shiki's FontStyle flags: 1 italic, 2 bold.
      const style: number = t.fontStyle ?? 0;
      if ((style & 1) !== 0) token.italic = true;
      if ((style & 2) !== 0) token.bold = true;
      return token;
    }),
  );
}
