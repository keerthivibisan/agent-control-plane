import type { ReactNode } from 'react';

/**
 * A small Markdown preview for skill instructions: headings, paragraphs, lists, block quotes,
 * fenced code, inline code, bold, italic and link text. It builds React elements only (no HTML
 * string is ever injected), and links are shown as text, so a preview can never navigate anywhere.
 * Anything it does not know is shown as plain text.
 */

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] ?? '```';
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(marker)) {
        code.push(lines[i] ?? '');
        i++;
      }
      i++; // the closing fence (or the end)
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(6, (heading[1] ?? '#').length) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: 'heading', level, text: heading[2] ?? '' });
      i++;
      continue;
    }
    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (i < lines.length) {
        const m = pattern.exec(lines[i] ?? '');
        if (m) {
          items.push(m[1] ?? '');
        } else if (/^\s{2,}\S/.test(lines[i] ?? '') && items.length > 0) {
          // A wrapped item continues on an indented line.
          items[items.length - 1] += ` ${(lines[i] ?? '').trim()}`;
        } else {
          break;
        }
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    if (line.trimStart().startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trimStart().startsWith('>')) {
        quote.push((lines[i] ?? '').trimStart().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'quote', text: quote.join(' ') });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (l.trim() === '' || HEADING.test(l) || FENCE.test(l) || BULLET.test(l) || NUMBERED.test(l))
        break;
      para.push(l.trim());
      i++;
    }
    blocks.push({ kind: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)]*\))/;

/** Inline spans, as React nodes. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const token = m[0];
    if (m[1]) {
      out.push(
        <code key={key++} className="rounded bg-sunken px-1 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={key++}>{renderInline(token.slice(2, -2))}</strong>);
    } else if (m[3]) {
      out.push(<em key={key++}>{renderInline(token.slice(1, -1))}</em>);
    } else {
      const label = token.slice(1, token.indexOf(']'));
      out.push(
        <span key={key++} className="text-accent underline">
          {label}
        </span>,
      );
    }
    rest = rest.slice(m.index + token.length);
  }
  return out;
}

const HEADING_CLASS: Record<number, string> = {
  1: 'text-title font-semibold',
  2: 'text-base font-semibold',
  3: 'font-semibold',
  4: 'font-medium',
  5: 'font-medium',
  6: 'font-medium',
};

export function MarkdownPreview({ source, empty }: { source: string; empty: string }) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) return <p className="text-dim">{empty}</p>;
  return (
    <div className="flex flex-col gap-3 leading-relaxed">
      {blocks.map((b, n) => {
        switch (b.kind) {
          case 'heading': {
            const Tag = `h${b.level}` as 'h1';
            return (
              <Tag key={n} className={HEADING_CLASS[b.level]}>
                {renderInline(b.text)}
              </Tag>
            );
          }
          case 'paragraph':
            return <p key={n}>{renderInline(b.text)}</p>;
          case 'quote':
            return (
              <blockquote key={n} className="border-l-2 border-line pl-3 text-dim">
                {renderInline(b.text)}
              </blockquote>
            );
          case 'code':
            return (
              <pre
                key={n}
                className="overflow-x-auto rounded-control bg-sunken p-3 font-mono text-caption"
              >
                <code>{b.text}</code>
              </pre>
            );
          case 'list': {
            const List = b.ordered ? 'ol' : 'ul';
            return (
              <List key={n} className={`${b.ordered ? 'list-decimal' : 'list-disc'} pl-6`}>
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
}
