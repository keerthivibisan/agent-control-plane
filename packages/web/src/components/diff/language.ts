/**
 * The syntax languages the diff viewer highlights: a bounded set of common ones (ADR-0025 §6), by
 * file extension. Anything else is shown as plain text. The ids are Shiki's language names.
 */
export type SyntaxLang =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'json'
  | 'markdown'
  | 'css'
  | 'html'
  | 'python'
  | 'java'
  | 'go'
  | 'rust'
  | 'yaml'
  | 'shellscript'
  | 'sql'
  | 'kotlin'
  | 'swift'
  | 'c'
  | 'cpp'
  | 'ruby'
  | 'php';

const BY_EXTENSION: Readonly<Record<string, SyntaxLang>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  html: 'html',
  htm: 'html',
  py: 'python',
  java: 'java',
  go: 'go',
  rs: 'rust',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  sql: 'sql',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  rb: 'ruby',
  php: 'php',
};

/** The language of a path from its extension, or null for plain text. */
export function languageFor(path: string): SyntaxLang | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null; // no extension, or a dotfile such as `.env`
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}
