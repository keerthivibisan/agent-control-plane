import {
  isFollowUp,
  MAX_AGENT_BYTES,
  MAX_CONTEXT_BYTES,
  MAX_REPO_MAP_BYTES,
  SkillNameSchema,
} from '@acp/core';
import type { ManagedAgentSpec } from '@acp/core';
import { offeredToolNames } from './lead-tools.js';
import { capUtf8 } from './summary.js';

/**
 * The thread's `developerInstructions` (CX-1 result 2: they reach the model, and with
 * `project_doc_max_bytes=0` no repository file is loaded). Codex has no Claude Code preset, so ACP
 * states the role's limits itself, then appends what the Claude adapter appends to its system
 * prompt: the project context (`MAX_CONTEXT_BYTES`) and the stage agent file's instructions
 * (`MAX_AGENT_BYTES`; its `tools` list is not supported, capability `profileTools: false`).
 * The repository map (ADR-0034 §4, `MAX_REPO_MAP_BYTES`) comes first of all, before the role
 * lines (which name the agent's own folder), so every agent of a run shares the same prefix for
 * the provider's prompt caching.
 */

const ROLE_LINES: Readonly<Record<ManagedAgentSpec['kind'], string>> = {
  lead: 'You are the lead agent of a ticket run. You read the project and coordinate helper agents with the control-plane tools; you do not change files yourself.',
  planner:
    'You are the planner. You read the project and write the plan with the submit_plan tool; you do not change files.',
  reviewer:
    'You are a reviewer. You read the code and report your findings with your review tool; you do not change files.',
  worker:
    'You are a helper agent. Do the task you are given by changing files in this folder only.',
  tester: 'You are the tester. Check the work and fix tests by changing files in this folder only.',
};

/** The F-1 rule in the wording of the git guard's refusal (`gitGuardMessage` in core). */
export const GIT_RULE =
  'The app owns branches and commits. Never run git commands that switch, create, commit, reset, merge, rebase, stash, fetch or push: they are refused. Your work is saved when you finish.';

const FOLLOW_UP_LINE =
  'This run has ended: you can only read files in the project and answer. New work needs a new run.';

/** The heading before a stage agent file's instructions, naming the file when the name is plain. */
function agentFileHeading(name: string): string {
  const file = SkillNameSchema.safeParse(name).success ? `.claude/agents/${name}.md` : 'agent file';
  return `=== Stage agent file ${file} (the owner's instructions for this stage) ===`;
}

export function developerInstructionsFor(spec: ManagedAgentSpec): string {
  const writes = (spec.kind === 'worker' || spec.kind === 'tester') && !isFollowUp(spec);
  const lines = [
    'You run inside Agent Control Plane (ACP), which manages this session.',
    ROLE_LINES[spec.kind],
    `Your folder is ${spec.cwd}.`,
  ];
  if (isFollowUp(spec)) lines.push(FOLLOW_UP_LINE);
  if (writes) lines.push(GIT_RULE);
  const tools = offeredToolNames(spec);
  if (tools.length > 0) lines.push(`Your control-plane tools: ${tools.join(', ')}.`);
  const dirs = spec.readOnlyDirs ?? [];
  if (dirs.length > 0) {
    lines.push(`You may also read these folders (read only): ${dirs.join(', ')}.`);
  }
  const parts: string[] = [];
  const repoMap = spec.repoMap ?? '';
  if (repoMap.trim() !== '') parts.push(capUtf8(repoMap, MAX_REPO_MAP_BYTES));
  parts.push(lines.join('\n'));
  const context = spec.context ?? '';
  if (context.trim() !== '') parts.push(capUtf8(context, MAX_CONTEXT_BYTES));
  const profile = spec.profile;
  if (profile !== undefined && profile.instructions.trim() !== '') {
    parts.push(
      `${agentFileHeading(profile.name)}\n${capUtf8(profile.instructions, MAX_AGENT_BYTES)}`,
    );
  }
  return parts.join('\n\n');
}
