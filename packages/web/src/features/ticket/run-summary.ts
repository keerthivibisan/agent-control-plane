// Reading the comments Agent Control Plane writes on a ticket (author `app`, ADR-0024 §3): the run
// summary, which the server composes as plain text with sections, and the one-line note after the
// owner's merge. The web never depends on a strict format: these helpers only pick out what reads
// better as a heading or a list, and everything else is shown as it was written. Since v0.3.0 S-C
// a summary is the lead's note (or one plain sentence) followed by a `Details:` section; a summary
// without that line is an older one and reads as before.

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

/**
 * A run summary in the layout of v0.3.0 S-C: the lead's note (or one plain sentence) as the
 * comment, and the facts after a `Details:` line.
 */
export interface HumanRunSummary {
  /** The server's later handover summary of the same run ("Run summary (updated)"). */
  updated: boolean;
  /** The lead's own note, as written, when it left one. */
  note: string | null;
  /** The comment's text: the note, or the app's one plain sentence when there is none. */
  text: string;
  /** The facts after `Details:`, read with the same rules as an older summary. */
  details: SummaryBlock[];
}

const DETAILS_LINE = 'Details:';
const NOTE_LINE = 'From the lead:';
const HEADING_LINE = /^run summary( \(updated\))?$/i;

/**
 * Splits a run summary in the S-C layout, or null for any other text (an older summary, which
 * shows as before). The facts start after the last `Details:` line: the server never writes one
 * inside them, while a note might.
 */
export function splitRunSummary(body: string): HumanRunSummary | null {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const at = lines.map((l) => l.trim()).lastIndexOf(DETAILS_LINE);
  if (at < 0) return null;
  const head = lines.slice(0, at);
  const first = HEADING_LINE.exec((head[0] ?? '').trim());
  if (first) head.shift();
  const main = head.join('\n').trim();
  const [lead, ...rest] = main.split('\n');
  const note = lead?.trim() === NOTE_LINE ? rest.join('\n').trim() : null;
  const text = note ?? main;
  if (text.length === 0) return null;
  return {
    updated: first?.[1] !== undefined,
    note: note !== null && note.length > 0 ? note : null,
    text,
    details: parseRunSummary(lines.slice(at + 1).join('\n')),
  };
}

/** The note after the owner's merge: "Merged acp/WEB-12 into main at 1a2b3c4". */
export interface MergeNote {
  branch: string;
  into: string;
  at: string;
  /**
   * What the server adds after the commit (S-A2): the tip's checks and whether the owner merged
   * anyway, as written right after the commit, e.g. `; checks passed on the tip (2)`. Absent when
   * there is nothing after the commit.
   */
  detail?: string;
}

/** A commit id, then optionally the server's detail after it. */
const MERGE_LINE_DETAIL = /^Merged (\S+) into (\S+) at ([0-9a-f]{7,64})\b(.*?)\.?$/;
const MERGE_LINE = /^Merged (\S+) into (\S+) at (\S.*?)\.?$/;

/** The merge note's parts, or null when the comment is anything else (a run summary). */
export function parseMergeLine(body: string): MergeNote | null {
  const text = body.trim();
  if (text.includes('\n') || text.length > 300) return null;
  const d = MERGE_LINE_DETAIL.exec(text);
  if (d?.[1] !== undefined && d[2] !== undefined && d[3] !== undefined) {
    // Kept as written right after the commit: `; checks …` or ` (merged anyway, …); checks …`.
    const detail = (d[4] ?? '').trimEnd();
    return { branch: d[1], into: d[2], at: d[3], ...(detail.trim().length > 0 && { detail }) };
  }
  const m = MERGE_LINE.exec(text);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  return { branch: m[1], into: m[2], at: m[3] };
}
