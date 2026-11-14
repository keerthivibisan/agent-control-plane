import { TicketCommentSchema } from '@acp/core';

/**
 * ADR-0037 §3: a researcher's findings note (up to `MAX_RESEARCH_FINDINGS_CHARS`) as the bodies of
 * its ticket comments of kind `research`. A comment body holds at most 8,000 characters (the
 * `ticket_comments.body` check of migration 0003, `TicketCommentSchema`), so a longer note is
 * stored as consecutive parts, each headed "(part i of n)". A part ends at a line break where one
 * is near (the break itself is dropped, so the parts joined with a line break are the note), else
 * before trailing white space, which comment bodies trim. No text is dropped.
 */

const MAX_BODY = TicketCommentSchema.shape.body.maxLength ?? 8000;
/** Room for the "(part i of n)" heading line. */
const HEADING_ROOM = 40;
/** A cut moves back to a line break at most this far. */
const BREAK_WINDOW = 400;

export function researchCommentBodies(text: string): string[] {
  if (text.length <= MAX_BODY) return [text];
  const size = MAX_BODY - HEADING_ROOM;
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const newline = rest.lastIndexOf('\n', size);
    if (newline > 0 && newline >= size - BREAK_WINDOW) {
      chunks.push(rest.slice(0, newline));
      rest = rest.slice(newline + 1);
      continue;
    }
    // No line break near: cut before any white space at the edge, which the next part keeps.
    let cut = size;
    while (cut > 1 && /\s/.test(rest.charAt(cut - 1))) cut--;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks.map((chunk, i) => `(part ${i + 1} of ${chunks.length})\n${chunk}`);
}
