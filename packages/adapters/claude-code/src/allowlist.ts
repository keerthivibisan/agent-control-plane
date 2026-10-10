import { realpathSync } from 'node:fs';
import path from 'node:path';
import { isPathInside } from '@acp/core';

/**
 * File access allowlist (docs/provider-adapters.md §3, security-critical). Only these shapes,
 * relative to `<claudeDir>/projects/`, may ever be opened:
 *
 *   <dir>/<uuid>.jsonl                               top-level transcript
 *   <dir>/<uuid>/subagents/agent-<id>.jsonl          subagent transcript
 *   <dir>/<uuid>/subagents/agent-<id>.meta.json      subagent metadata
 *
 * Everything else is denied by construction: `sessions/`, settings, `history.jsonl`, `memory/`,
 * `tool-results/`, `*.orphaned-*`, `*.superseded-*`, and any other per-session file never match.
 */
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const AGENT_ID_RE = /^[A-Za-z0-9]+$/;

const TRANSCRIPT_FILE_RE = /^([0-9a-f-]{36})\.jsonl$/;
const SUBAGENT_FILE_RE = /^agent-([A-Za-z0-9]+)\.(jsonl|meta\.json)$/;

export const DEFAULT_MAX_FILE_BYTES = 512 * 1024 * 1024;
/** Subagent meta files are small JSON documents; anything larger is not a meta file we understand. */
export const MAX_META_BYTES = 1024 * 1024;

export type SourceKind = 'transcript' | 'subagent-transcript' | 'subagent-meta';

export interface ClassifiedPath {
  kind: SourceKind;
  /** Encoded project directory name. Never decoded: the encoding is lossy (§4.1). */
  projectDir: string;
  sessionId: string;
  /** Subagent id for subagent files, otherwise null. */
  agentId: string | null;
}

/** Classifies a path relative to `<claudeDir>/projects/`; null means denied. */
export function classifyRelative(relative: string): ClassifiedPath | null {
  const parts = relative.split(/[\\/]/);
  const [projectDir, second, third, fourth] = parts;
  if (projectDir === undefined || !isPlainSegment(projectDir)) return null;

  if (parts.length === 2 && second !== undefined) {
    const m = TRANSCRIPT_FILE_RE.exec(second);
    const sessionId = m?.[1];
    if (sessionId === undefined || !SESSION_ID_RE.test(sessionId)) return null;
    return { kind: 'transcript', projectDir, sessionId, agentId: null };
  }

  if (parts.length === 4 && second !== undefined && fourth !== undefined) {
    if (!SESSION_ID_RE.test(second) || third !== 'subagents') return null;
    const m = SUBAGENT_FILE_RE.exec(fourth);
    const agentId = m?.[1];
    if (agentId === undefined || !AGENT_ID_RE.test(agentId)) return null;
    return {
      kind: m?.[2] === 'jsonl' ? 'subagent-transcript' : 'subagent-meta',
      projectDir,
      sessionId: second,
      agentId,
    };
  }
  return null;
}

function isPlainSegment(s: string): boolean {
  return s.length > 0 && s !== '.' && s !== '..';
}

/** True when two classifications name the same source (used to reject symlinks that re-point). */
export function sameSource(a: ClassifiedPath, b: ClassifiedPath): boolean {
  return a.kind === b.kind && a.sessionId === b.sessionId && a.agentId === b.agentId;
}

/**
 * Synchronous allowlist check for a path that arrives from outside, such as a hook's
 * `transcript_path`. Returns the real path when it resolves inside `<claudeDir>/projects/` and
 * classifies as a transcript (top-level or subagent) both before and after `realpath`; else null.
 */
export function resolveAllowedTranscriptSync(claudeDir: string, candidate: string): string | null {
  if (!path.isAbsolute(candidate)) return null;
  try {
    const projects = realpathSync(path.join(claudeDir, 'projects'));
    const real = realpathSync(candidate);
    if (!isPathInside(projects, real)) return null;
    const realClass = classifyRelative(path.relative(projects, real));
    if (realClass === null || realClass.kind === 'subagent-meta') return null;
    // The logical path must be allowlisted too, relative to either spelling of the projects dir.
    const logicalBase = isPathInside(projects, candidate)
      ? projects
      : path.resolve(claudeDir, 'projects');
    if (!isPathInside(logicalBase, candidate)) return null;
    const logicalClass = classifyRelative(path.relative(logicalBase, path.resolve(candidate)));
    if (logicalClass === null || !sameSource(logicalClass, realClass)) return null;
    return real;
  } catch {
    // Missing file or unreadable directory: the path is simply not usable.
    return null;
  }
}
