import {
  answerCodeMapTool,
  LeadToolInputs,
  NO_CODE_MAP_MESSAGE,
  renderRepoMap,
  type CodeMapFile,
  type CodeMapManifest,
} from '@acp/core';

/**
 * A run's code map (ADR-0034 §3, §4; CM-2): the map of the run's base commit is built in the
 * background when a ticket run starts, and never blocks or fails the run. An agent that launches
 * once it is ready gets the repository map in its context; the first launches wait for it at most
 * `CODE_MAP_WAIT_MS`. Every agent's `code_map` tool answers from it, or refuses without it.
 */

/** The part of the code map service a run uses. */
export interface RunCodeMapSource {
  ensureForCommit(projectId: string, commit: string): Promise<CodeMapManifest>;
  mapAt(
    projectId: string,
    commit: string,
  ): { manifest: CodeMapManifest; files: readonly CodeMapFile[] } | undefined;
}

/** How long launches may wait for the map after the run started (ADR-0034 CM-2: 15 seconds). */
export const CODE_MAP_WAIT_MS = 15_000;

export interface RunCodeMap {
  /** The run's base commit once resolved; null before, or when it could not be resolved. */
  commit: string | null;
  /**
   * Resolves when launches stop waiting: the build settled (ready or failed) or the wait window
   * ended. Null once that happened. Never rejects.
   */
  waiting: Promise<void> | null;
  /** The rendered repository map, cached per commit. */
  repoMap?: { commit: string; text: string };
}

export interface StartRunCodeMap {
  source: RunCodeMapSource;
  projectId: string;
  /** The commit the run's ticket branch starts at (or will); null when there is none. */
  baseCommit: () => Promise<string | null>;
  waitMs: number;
  /** A failed build or unresolved commit: a short code, counted and logged by the caller. */
  onFailure: (code: string) => void;
}

/** A short code for a failure; never a message (it may hold paths). */
function failureCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return /^[a-z][a-z0-9_-]{0,40}$/.test(error.code) ? error.code : 'index_failed';
  }
  return 'index_failed';
}

/** Starts building the run's map in the background; the returned state tracks it. */
export function startRunCodeMap(input: StartRunCodeMap): RunCodeMap {
  const state: RunCodeMap = { commit: null, waiting: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const window = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, input.waitMs);
    // The window never keeps the process alive on shutdown.
    timer.unref?.();
  });
  const build = (async () => {
    const commit = await input.baseCommit();
    if (commit === null) {
      input.onFailure('no_base_commit');
      return;
    }
    state.commit = commit;
    await input.source.ensureForCommit(input.projectId, commit);
  })().catch((error: unknown) => {
    input.onFailure(failureCode(error));
  });
  state.waiting = Promise.race([build, window]).then(() => {
    clearTimeout(timer);
    state.waiting = null;
  });
  return state;
}

/**
 * The repository map for an agent's context: only when a ready map exists for `commit`. Rendered
 * once per commit and cached on `state`.
 */
export function repoMapText(
  source: RunCodeMapSource,
  projectId: string,
  commit: string | null,
  state: { repoMap?: { commit: string; text: string } },
): string | undefined {
  if (commit === null) return undefined;
  if (state.repoMap?.commit === commit) return state.repoMap.text;
  const map = source.mapAt(projectId, commit);
  if (map === undefined) return undefined;
  const text = renderRepoMap(map.manifest, map.files);
  state.repoMap = { commit, text };
  return text;
}

/**
 * The `code_map` tool's answer from the map of `commit` (ADR-0034 §4). Throws with a short,
 * content-free message on a refusal: no map yet, a missing field or a bad path. The adapter
 * returns it to the model as a tool error.
 */
export function codeMapToolReply(
  source: RunCodeMapSource,
  projectId: string,
  commit: string | null,
  input: unknown,
): string {
  const parsed = LeadToolInputs.code_map.safeParse(input);
  // The engine validated it already; this narrows the type.
  if (!parsed.success) throw new Error('Invalid input for code_map.');
  const map = commit === null ? undefined : source.mapAt(projectId, commit);
  if (map === undefined) throw new Error(NO_CODE_MAP_MESSAGE);
  const result = answerCodeMapTool(map.manifest, map.files, parsed.data);
  if (!result.ok) throw new Error(result.message);
  return result.text;
}
