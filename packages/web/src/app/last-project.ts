/**
 * The project the app reopens (the top-bar switcher and `#/`). Remembered in this browser only.
 * Storage can be unavailable (private windows, blocked site data), so every access is guarded and
 * a miss just means "no last project".
 */
const KEY = 'acp.lastProject';
/** Written by the board before the redesign (features/board/last-project.ts); still read. */
const BOARD_KEY = 'acp.board.lastProject';

export function readLastProject(): string | null {
  try {
    return window.localStorage.getItem(KEY) ?? window.localStorage.getItem(BOARD_KEY);
  } catch {
    return null;
  }
}

export function rememberLastProject(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Not remembering is harmless: `#/` then opens All projects.
  }
}

/** The remembered project if it still exists, else null. */
export function validLastProject(
  projects: readonly { id: string }[],
  remembered: string | null,
): string | null {
  return remembered !== null && projects.some((p) => p.id === remembered) ? remembered : null;
}
