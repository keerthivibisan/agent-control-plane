/**
 * The board opens the last used project (README §5.2). Remembered in this browser only; storage
 * can be unavailable (private windows, blocked site data), so every access is guarded and a miss
 * just means "the first project".
 */
const KEY = 'acp.board.lastProject';

export function readLastProject(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberProject(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Not remembering is harmless: the board falls back to the first project.
  }
}

/** The project `#/board` opens: the remembered one if it still exists, else the first. */
export function defaultProjectId(
  projects: readonly { id: string }[],
  remembered: string | null,
): string | null {
  if (remembered !== null && projects.some((p) => p.id === remembered)) return remembered;
  return projects[0]?.id ?? null;
}
