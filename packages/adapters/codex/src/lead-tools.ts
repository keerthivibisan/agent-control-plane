import { LeadToolInputs, managedToolNames } from '@acp/core';
import type { LeadToolName, ManagedAgentSpec } from '@acp/core';
import { z } from 'zod';
import { cleanFreeText } from './summary.js';

/**
 * ACP's control-plane tools for Codex: app-server dynamic tools given on `thread/start` and called
 * through `item/tool/call` (CX-1 result 5; `initialize` declares `experimentalApi`). The set is the
 * role's, from core (`managedToolNames`), exactly as the Claude adapter's MCP server offers it.
 */

/**
 * What the model is told about each tool; the engine decides. The same wording as the Claude
 * adapter's (adapters never import each other, so it is copied).
 */
const DESCRIPTIONS: Record<LeadToolName, string> = {
  start_agent:
    'Start a worker agent with a short role name and one task. It works in its own copy of the ' +
    'project. The control plane may refuse (limits, budget, run state) and says why.',
  list_agents: 'List the worker agents you manage, with their status.',
  message_agent: 'Send a follow-up message to one of your worker agents.',
  stop_agent: 'Stop one of your worker agents.',
  agent_status: "Get one of your worker agents' status, latest activity and budget use.",
  request_review:
    "Hand the work over when you are done: no helper is working and, with change review, every helper's change is decided. With change review you must call it once every change is decided (merged, discarded or with no changes): nothing goes on until you do. The final review and the owner come next.",
  submit_plan:
    'Submit your plan for this ticket: a short summary and the steps (title, which helper role does it, detail). The owner approves it or asks for changes before any helper can start.',
  post_review:
    'Post your code review findings as plain text. They become a comment on the ticket for the owner; they do not block or merge anything.',
  view_change:
    "See one helper's finished change: the files it changed, the diff (cut at 32 KiB), its checks and the review so far.",
  merge_change:
    "Merge one helper's change into the ticket branch. When the workflow has Checks before the merge, they must pass on it first; if they have not run yet, they start and you get a message when they finish.",
  request_rework:
    'Send one helper its change back with what to fix. It works on it again in its own copy. Refused once its rework rounds are used up.',
  discard_change: "Drop one helper's change, with a short reason the owner can read.",
  ask_owner: "Leave the decision about one helper's change to the owner, with your question.",
  submit_review:
    'Submit your review of this change: a verdict (approve or rework) and your findings as plain text. The lead decides what happens next.',
  report_work:
    'Report what you did, in 2 to 4 plain sentences (what changed, how you checked it). It becomes your note on the ticket; a later report replaces it.',
};

/** A `DynamicToolSpec` of the `function` kind (CLI 0.166.0). */
export interface DynamicToolSpec {
  type: 'function';
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** The tools offered to this agent: none without a handler (`spec.leadTools`). */
export function offeredToolNames(
  spec: Pick<
    ManagedAgentSpec,
    'kind' | 'followUp' | 'reviewScope' | 'canStartHelpers' | 'leadTools'
  >,
): readonly LeadToolName[] {
  return spec.leadTools === undefined ? [] : managedToolNames(spec);
}

/**
 * The JSON Schema of one tool's input, from the contract schema. Unknown properties are refused
 * (`additionalProperties: false`), and the `$schema` key is dropped: the model gets a plain schema.
 */
export function toolInputSchema(name: LeadToolName): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(LeadToolInputs[name]) as Record<
    string,
    unknown
  >;
  return { ...schema, additionalProperties: false };
}

export function dynamicToolsFor(
  spec: Pick<
    ManagedAgentSpec,
    'kind' | 'followUp' | 'reviewScope' | 'canStartHelpers' | 'leadTools'
  >,
): DynamicToolSpec[] {
  return offeredToolNames(spec).map((name) => ({
    type: 'function',
    name,
    description: DESCRIPTIONS[name],
    inputSchema: toolInputSchema(name),
  }));
}

/** The answer to `item/tool/call` (`DynamicToolCallResponse`). */
export interface DynamicToolCallResult {
  contentItems: { type: 'inputText'; text: string }[];
  success: boolean;
}

const CallSchema = z.looseObject({
  tool: z.string(),
  namespace: z.string().nullable().catch(null),
  arguments: z.unknown(),
});

export const NOT_OFFERED = 'This control-plane tool is not available to this agent.';
const REFUSED = 'The control plane could not run this tool';

function answer(text: string, success: boolean): DynamicToolCallResult {
  return { contentItems: [{ type: 'inputText', text }], success };
}

/**
 * Runs one dynamic tool call through the engine's handler (which validates and decides, ADR-0013).
 * A tool this agent was not offered, a namespaced name or a bad call gives `success: false`; a
 * throw gives `success: false` with a redacted message, never a crashed agent.
 */
export async function callLeadTool(
  spec: Pick<
    ManagedAgentSpec,
    'kind' | 'followUp' | 'reviewScope' | 'canStartHelpers' | 'leadTools'
  >,
  params: unknown,
): Promise<DynamicToolCallResult> {
  const call = CallSchema.safeParse(params);
  const handler = spec.leadTools;
  if (!call.success || handler === undefined || call.data.namespace !== null) {
    return answer(NOT_OFFERED, false);
  }
  const name = offeredToolNames(spec).find((offered) => offered === call.data.tool);
  if (name === undefined) return answer(NOT_OFFERED, false);
  try {
    return answer(await handler(name, call.data.arguments ?? {}), true);
  } catch (error) {
    const detail = error instanceof Error ? cleanFreeText(error.message, 300) : null;
    return answer(detail === null ? `${REFUSED}.` : `${REFUSED}: ${detail}`, false);
  }
}
