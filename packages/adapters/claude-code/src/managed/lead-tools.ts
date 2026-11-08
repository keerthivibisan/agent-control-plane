import { LEAD_TOOL_NAMES, LeadToolInputs } from '@acp/core';
import type { LeadToolHandler, LeadToolName } from '@acp/core';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import { cleanFreeText } from '../redact.js';
import { LEAD_MCP_SERVER_NAME, LEAD_ROLE_TOOL_NAMES } from './permissions.js';

type CallToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;
/** The server option's own element type (the SDK declares it with an `any` schema). */
type LeadToolDefinitions = NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']>;

/**
 * What the model is told about each tool. The engine decides; these only describe. The wording
 * fits both the lead and a depth-2 parent helper ("your" workers: the engine scopes each call).
 */
const DESCRIPTIONS: Record<LeadToolName, string> = {
  start_agent:
    'Start a worker agent with a short role name and one task. It works in its own copy of the ' +
    'project. Optional files (up to 20 repository-relative paths) and notes (your findings: what ' +
    'you learned, where the code is, constraints) go into its first prompt as starting points; ' +
    'fill them from what you read or found with code_map. They are hints, not a limit on what it ' +
    "may change. Without them it gets the matching plan step's. The control plane may refuse " +
    '(limits, budget, run state) and says why.',
  list_agents: 'List the worker agents you manage, with their status.',
  message_agent:
    'Send a message to one of your worker agents, or answer an agent that asked you a question (ask_lead). The reply says whether it was delivered now, queued for its next turn, or dropped (the agent ended) and why.',
  stop_agent: 'Stop one of your worker agents.',
  agent_status: "Get one of your worker agents' status, latest activity and budget use.",
  request_review:
    "Hand the work over when you are done: no helper is working and, with change review, every helper's change is decided. With change review you must call it once every change is decided (merged, discarded or with no changes): nothing goes on until you do. The final review and the owner come next.",
  submit_plan:
    'Submit your plan for this ticket: a short summary and the steps (title, which helper role does it, detail). Give a step files (up to 20 repository-relative paths) and notes (your findings: what you learned, where the code is, constraints) from what you read or found with code_map: its helper starts from them instead of searching again. They are hints, not a limit on what the helper may change. The owner approves the plan or asks for changes before any helper can start.',
  post_review:
    'Post your code review findings as plain text. They become a comment on the ticket for the owner; they do not block or merge anything.',
  // ADR-0021 review loop: the lead's change tools and the change reviewer's one tool.
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
  ask_lead:
    'Ask the agent that started you (the lead, or your parent helper) one short question. It gets it as a message and answers with a message to you; keep working meanwhile. The reply says whether it was delivered, queued or dropped. At most 5 open questions at a time.',
  get_review_findings:
    "Get the stored review findings of one helper's change again: the review agent's verdict and findings text. Refused when no review agent has reviewed it.",
  code_map:
    "Look up the project's code map at the run's base commit: paths, symbol names and line numbers, never file content. action find_symbol (query: a symbol name) says where it is declared; file (path) lists its exports, imports, importers and tests; neighbors (path, depth 1 or 2) lists files linked to it by imports; search (query) matches symbol names and paths. Use it before broad searches, then read only the files you need. Refused when no map is built yet.",
};

const REFUSED = 'The control plane could not run this tool';

function text(value: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

/**
 * Wraps the engine's handler for one tool. The handler validates and decides (ADR-0013); a throw
 * becomes an MCP error result for the model, with a redacted message, never a crashed server.
 */
function run(handler: LeadToolHandler, name: LeadToolName) {
  return async (args: unknown): Promise<CallToolResult> => {
    try {
      return text(await handler(name, args));
    } catch (error) {
      const detail = error instanceof Error ? cleanFreeText(error.message, 300) : null;
      return text(detail === null ? `${REFUSED}.` : `${REFUSED}: ${detail}`, true);
    }
  };
}

/**
 * The tool definitions for `names` (default: every name in `LeadToolInputs`, the lead's set,
 * ADR-0012), in contract order, with the contract schemas as input schemas. A depth-2 parent helper
 * gets `HELPER_PARENT_TOOL_NAMES`. Exported for tests; production code uses `createLeadToolServer`.
 */
export function leadToolDefinitions(
  handler: LeadToolHandler,
  names: readonly LeadToolName[] = LEAD_TOOL_NAMES,
): LeadToolDefinitions {
  const d = DESCRIPTIONS;
  const i = LeadToolInputs;
  const all: Record<LeadToolName, LeadToolDefinitions[number]> = {
    start_agent: tool(
      'start_agent',
      d.start_agent,
      i.start_agent.shape,
      run(handler, 'start_agent'),
    ),
    list_agents: tool(
      'list_agents',
      d.list_agents,
      i.list_agents.shape,
      run(handler, 'list_agents'),
    ),
    message_agent: tool(
      'message_agent',
      d.message_agent,
      i.message_agent.shape,
      run(handler, 'message_agent'),
    ),
    stop_agent: tool('stop_agent', d.stop_agent, i.stop_agent.shape, run(handler, 'stop_agent')),
    agent_status: tool(
      'agent_status',
      d.agent_status,
      i.agent_status.shape,
      run(handler, 'agent_status'),
    ),
    request_review: tool(
      'request_review',
      d.request_review,
      i.request_review.shape,
      run(handler, 'request_review'),
    ),
    submit_plan: tool(
      'submit_plan',
      d.submit_plan,
      i.submit_plan.shape,
      run(handler, 'submit_plan'),
    ),
    post_review: tool(
      'post_review',
      d.post_review,
      i.post_review.shape,
      run(handler, 'post_review'),
    ),
    view_change: tool(
      'view_change',
      d.view_change,
      i.view_change.shape,
      run(handler, 'view_change'),
    ),
    merge_change: tool(
      'merge_change',
      d.merge_change,
      i.merge_change.shape,
      run(handler, 'merge_change'),
    ),
    request_rework: tool(
      'request_rework',
      d.request_rework,
      i.request_rework.shape,
      run(handler, 'request_rework'),
    ),
    discard_change: tool(
      'discard_change',
      d.discard_change,
      i.discard_change.shape,
      run(handler, 'discard_change'),
    ),
    ask_owner: tool('ask_owner', d.ask_owner, i.ask_owner.shape, run(handler, 'ask_owner')),
    submit_review: tool(
      'submit_review',
      d.submit_review,
      i.submit_review.shape,
      run(handler, 'submit_review'),
    ),
    report_work: tool(
      'report_work',
      d.report_work,
      i.report_work.shape,
      run(handler, 'report_work'),
    ),
    ask_lead: tool('ask_lead', d.ask_lead, i.ask_lead.shape, run(handler, 'ask_lead')),
    get_review_findings: tool(
      'get_review_findings',
      d.get_review_findings,
      i.get_review_findings.shape,
      run(handler, 'get_review_findings'),
    ),
    code_map: tool('code_map', d.code_map, i.code_map.shape, run(handler, 'code_map')),
  };
  return LEAD_TOOL_NAMES.filter((name) => names.includes(name)).map((name) => all[name]);
}

/**
 * The in-process MCP server (`mcpServers.acp`) given to the lead with every tool, or to a depth-2
 * parent helper with `HELPER_PARENT_TOOL_NAMES`, or to a worker or tester with `report_work`
 * (ADR-0026 §3). An agent without a handler gets no server.
 */
export function createLeadToolServer(
  handler: LeadToolHandler,
  names: readonly LeadToolName[] = LEAD_ROLE_TOOL_NAMES,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: LEAD_MCP_SERVER_NAME,
    version: '1.0.0',
    tools: leadToolDefinitions(handler, names),
    alwaysLoad: true,
  });
}
