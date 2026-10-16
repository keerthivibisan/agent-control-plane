import { homedir } from 'node:os';
import { AgentToolNameSchema, MAX_AGENT_BYTES, SkillNameSchema } from '@acp/core';
import type { ManagedAgentSpec } from '@acp/core';
import { HttpError } from '../errors.js';
import { parseAgentFile } from '../skills/frontmatter.js';
import { agentTarget, readTargetFile, realRoot, refusePersonalClaudeDir } from '../skills/paths.js';

/**
 * A workflow stage's project agent file, `<project root>/.claude/agents/<name>.md` (ADR-0019 §6,
 * the ADR-0018 amendment), turned into `ManagedAgentSpec.profile` when that stage's agent starts.
 *
 * - The file is read from the **owner's project checkout** (the registered root), never from an
 *   agent worktree, with R-D's path rules (`skills/paths.ts`): the root is realpath'd, a symlink at
 *   `.claude`, `.claude/agents` or the file is refused, the file is opened with `O_NOFOLLOW`, and it
 *   is capped at `MAX_AGENT_BYTES`.
 * - Only the body (instructions), `model` and `tools` are used. Every other front-matter key
 *   (`permissionMode`, `hooks`, `mcpServers`, `skills`, `memory`, …) is ignored, because several can
 *   widen an agent's permissions.
 * - A file with any front-matter problem is treated as unparsable as a whole, so a misread line can
 *   never change what `tools` means. The agent then starts without a profile (its role's normal
 *   tools, the stage or project model) and the run is not blocked.
 *
 * Results carry a reason code only: file contents never reach a log or an error.
 */

export type AgentProfile = NonNullable<ManagedAgentSpec['profile']>;

export type AgentProfileProblem =
  'invalid-name' | 'missing' | 'unsafe' | 'too-large' | 'not-text' | 'unparsable' | 'unreadable';

export type AgentProfileResult =
  | {
      ok: true;
      profile: AgentProfile;
      /** The file's `model`, or null when it sets none (or an unusable one). */
      model: string | null;
    }
  | { ok: false; problem: AgentProfileProblem };

export interface AgentProfiles {
  read(projectRoot: string, name: string): Promise<AgentProfileResult>;
}

export interface AgentProfilesDeps {
  /** The owner's home folder, whose `.claude` is never opened. Injected so tests never use it. */
  homeDir?: string;
}

const MAX_MODEL_CHARS = 100;

export function createAgentProfiles(deps: AgentProfilesDeps = {}): AgentProfiles {
  return {
    async read(projectRoot, name) {
      if (!SkillNameSchema.safeParse(name).success) return { ok: false, problem: 'invalid-name' };
      let read;
      try {
        const root = await realRoot(projectRoot);
        await refusePersonalClaudeDir(root, deps.homeDir ?? homedir());
        read = await readTargetFile(agentTarget(root, name), MAX_AGENT_BYTES);
      } catch (error) {
        if (error instanceof HttpError) {
          return { ok: false, problem: error.code === 'not_found' ? 'missing' : 'unsafe' };
        }
        return { ok: false, problem: 'unreadable' };
      }
      switch (read.kind) {
        case 'missing':
          return { ok: false, problem: 'missing' };
        case 'too-large':
          return { ok: false, problem: 'too-large' };
        case 'not-text':
          return { ok: false, problem: 'not-text' };
        case 'ok':
          return profileFromText(name, read.text);
      }
    },
  };
}

/** The profile in an agent file's text; pure, so the parsing rules are tested on their own. */
export function profileFromText(name: string, text: string): AgentProfileResult {
  const parsed = parseAgentFile(text);
  if (parsed.fields === null || parsed.problems.length > 0) {
    return { ok: false, problem: 'unparsable' };
  }
  const listed = parsed.lists['tools'];
  // Absent: the role's normal set. Present: only valid tool names, which can only narrow further.
  const tools =
    listed === undefined ? null : listed.filter((t) => AgentToolNameSchema.safeParse(t).success);
  const rawModel = parsed.fields['model']?.trim() ?? '';
  const model = rawModel !== '' && rawModel.length <= MAX_MODEL_CHARS ? rawModel : null;
  return { ok: true, profile: { name, instructions: parsed.body, tools }, model };
}
