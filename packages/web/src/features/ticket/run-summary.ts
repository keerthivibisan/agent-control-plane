// Reading the comments Agent Control Plane writes on a ticket (author `app`, ADR-0024 §3): the run
// summary, which the server composes as plain text with sections, and the one-line note after the
// owner's merge. The web never depends on a strict format: these helpers only pick out what reads
// better as a heading or a list, and everything else is shown as it was written.

/** One part of a run summary, in order. */
export type SummaryBlock =
  | { type: 'heading'; text: string }
  | { type: 'list'; items: { text: string; depth: number }[] }
  /** Lines shown as written, line breaks kept. */
  | { type: 'text'; lines: string[] };

/** A heading longer than this is a sentence that happens to end with a colon. */
const MAX_HEADING = 80;
const LIST_ITEM = /^(\s*)- (.*)$/;
/** The server's own first line repeats the card's title, so it is not shown twice. */
const TITLE_LINE = /^run summary:?$/i;

/**
 * Splits a run summary into blocks:
 * - a line ending with a colon (and short, not a list item) is a heading; the colon is dropped;
 * - lines starting with "- " are list items (two spaces of indent per level);
 * - other lines are text, as is; blank lines separate blocks.
 */
export function parseRunSummary(body: string): SummaryBlock[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 0 && TITLE_LINE.test((lines[0] ?? '').trim())) lines.shift();
  const blocks: SummaryBlock[] = [];
  const last = () => blocks[blocks.length - 1];
  let open = false; // whether the next line may join the last list or text block
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().length === 0) {
      open = false;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const text = (item[2] ?? '').trim();
      const depth = Math.min(Math.floor((item[1] ?? '').length / 2), 3);
      const prev = last();
      // A list goes on across blank lines: "- a", "", "- b" is still one list.
      if (prev?.type === 'list') prev.items.push({ text, depth });
      else blocks.push({ type: 'list', items: [{ text, depth }] });
      open = true;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.endsWith(':') && trimmed.length > 1 && trimmed.length <= MAX_HEADING) {
      blocks.push({ type: 'heading', text: trimmed.slice(0, -1).trimEnd() });
      open = false;
      continue;
    }
    const prev = last();
    if (open && prev?.type === 'text') prev.lines.push(line);
    else blocks.push({ type: 'text', lines: [line] });
    open = true;
  }
  return blocks;
}

/** The note after the owner's merge: "Merged acp/WEB-12 into main at 1a2b3c4". */
export interface MergeNote {
  branch: string;
  into: string;
  at: string;
}

const MERGE_LINE = /^Merged (\S+) into (\S+) at (\S.*?)\.?$/;

/** The merge note's parts, or null when the comment is anything else (a run summary). */
export function parseMergeLine(body: string): MergeNote | null {
  const text = body.trim();
  if (text.includes('\n') || text.length > 300) return null;
  const m = MERGE_LINE.exec(text);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  return { branch: m[1], into: m[2], at: m[3] };
}
