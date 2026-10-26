import type { ReactNode } from 'react';

/*
 * Safe formatting for text written on a ticket (comments, the lead's summary, agents' notes,
 * findings; ADR-0026 "safe formatting"): paragraphs (line breaks kept), lists, block quotes,
 * fenced and inline code, bold, italic and links. It only builds React elements, so no HTML in
 * the text is ever parsed: `<b>` shows as the characters `<b>`. Links open only for `http:`,
 * `https:` and `mailto:` addresses, in a new tab without a referrer; any other target (such as
 * `javascript:`) stays plain text. Headings read as bold lines, so a comment never adds to the
 * page's outline. The skills editor has its own preview (features/skills/markdown.tsx), whose
 * links are text only by design.
 */

export type RichBlock =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; text: string };

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || NUMBERED.test(line);
}

export function parseRichText(source: string): RichBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: RichBlock[] = [];
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
      i++; // the closing fence, or the end
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] ?? '' });
      i++;
      continue;
    }
    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? '';
        const m = pattern.exec(l);
        if (m) items.push(m[1] ?? '');
        else if (/^\s{2,}\S/.test(l) && items.length > 0) items[items.length - 1] += ` ${l.trim()}`;
        else break;
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    if (QUOTE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i] ?? '');
        if (!m) break;
        quote.push(m[1] ?? '');
        i++;
      }
      blocks.push({ kind: 'quote', lines: quote });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (l.trim() === '' || startsBlock(l) || QUOTE.test(l)) break;
      para.push(l.trimEnd());
      i++;
    }
    blocks.push({ kind: 'paragraph', lines: para });
  }
  return blocks;
}

/** The addresses a link may open; everything else stays text. */
export function safeHref(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)[^\s]+$/i.test(u) ? u : null;
}

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b)|(\[[^\]]+\]\([^)\s]*\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/;

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-accent underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}

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
        <code
          key={key++}
          className="rounded-[0.25rem] border border-line bg-sunken px-1 py-px font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={key++}>{renderInline(token.slice(2, -2))}</strong>);
    } else if (m[3]) {
      out.push(<em key={key++}>{renderInline(token.slice(1, -1))}</em>);
    } else if (m[4]) {
      const close = token.indexOf('](');
      const label = token.slice(1, close);
      const href = safeHref(token.slice(close + 2, -1));
      out.push(
        href !== null ? (
          <Link key={key++} href={href}>
            {label}
          </Link>
        ) : (
          <span key={key++}>{label}</span>
        ),
      );
    } else {
      out.push(
        <Link key={key++} href={token}>
          {token}
        </Link>,
      );
    }
    rest = rest.slice(m.index + token.length);
  }
  return out;
}

/** Lines of one paragraph or quote, their line breaks kept. */
function Lines({ lines }: { lines: readonly string[] }) {
  return lines.map((l, i) => (
    <span key={i}>
      {i > 0 ? <br /> : null}
      {renderInline(l)}
    </span>
  ));
}

export function RichText({
  text,
  className = '',
  testId,
}: {
  text: string;
  className?: string;
  testId?: string;
}) {
  const blocks = parseRichText(text);
  return (
    <div
      className={`flex min-w-0 flex-col gap-3 leading-6 break-words ${className}`}
      data-testid={testId}
    >
      {blocks.map((b, n) => {
        switch (b.kind) {
          case 'paragraph':
            return (
              <p key={n}>
                <Lines lines={b.lines} />
              </p>
            );
          case 'heading':
            return (
              <p key={n} className="font-semibold">
                {renderInline(b.text)}
              </p>
            );
          case 'quote':
            return (
              <blockquote key={n} className="border-l-2 border-line-strong pl-3 text-dim">
                <Lines lines={b.lines} />
              </blockquote>
            );
          case 'code':
            return (
              <pre
                key={n}
                className="overflow-x-auto rounded-control border border-line bg-sunken p-3 font-mono text-caption"
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
