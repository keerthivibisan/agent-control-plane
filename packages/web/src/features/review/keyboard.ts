/**
 * The review page's keys (v0.3.0 D-A), GitHub's: `j` next file, `k` previous file, `v` mark the
 * current file viewed (or not), `c` comment on the focused line. Never while the owner types in a
 * box, uses a modifier, or works in a dialog, popover or menu (the ⌘K palette, Review changes).
 */

export type ReviewShortcut = 'next' | 'previous' | 'viewed' | 'comment';

const KEYS: Readonly<Record<string, ReviewShortcut>> = {
  j: 'next',
  k: 'previous',
  v: 'viewed',
  c: 'comment',
};

/** Where a key belongs to something else: text entry, or an open dialog, popover or menu. */
const BUSY = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]';

export function shortcutFor(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
}): ReviewShortcut | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  const shortcut = KEYS[e.key];
  if (shortcut === undefined) return null;
  const target = e.target;
  if (target instanceof Element && target.closest(BUSY) !== null) return null;
  return shortcut;
}
