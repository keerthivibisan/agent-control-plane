import { LeadToolInputs } from '@acp/core';
import type { LeadToolHandler, LeadToolName } from '@acp/core';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import { cleanFreeText } from '../redact.js';
import { LEAD_MCP_SERVER_NAME } from './permissions.js';

type CallToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;
/** The server option's own element type (the SDK declares it with an `any` schema). */
type LeadToolDefinitions = NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']>;

/** What the model is told about each lead tool. The engine decides; these only describe. */
const DESCRIPTIONS: Record<LeadToolName, string> = {
  start_agent:
    'Start a worker agent with a short role name and one task. It works in its own copy of the ' +
    'project. The control plane may refuse (limits, budget, run state) and says why.',
  list_agents: 'List the worker agents of this run with their status.',
  message_agent: 'Send a follow-up message to one worker agent.',
  stop_agent: 'Stop one worker agent.',
  agent_status: "Get one worker agent's status, latest activity and budget use.",
  request_review: 'Tell the owner the workers are done and their changes are ready for review.',
  submit_plan:
    'Submit your plan for this ticket: a short summary and the steps (title, which helper role does it, detail). The owner approves it or asks for changes before any helper can start.',
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
 * The lead's tool definitions, exactly the names in `LeadToolInputs` (ADR-0012), with the contract
 * schemas as input schemas. Exported for tests; production code uses `createLeadToolServer`.
 */
export function leadToolDefinitions(handler: LeadToolHandler): LeadToolDefinitions {
  const d = DESCRIPTIONS;
  const i = LeadToolInputs;
  return [
    tool('start_agent', d.start_agent, i.start_agent.shape, run(handler, 'start_agent')),
    tool('list_agents', d.list_agents, i.list_agents.shape, run(handler, 'list_agents')),
    tool('message_agent', d.message_agent, i.message_agent.shape, run(handler, 'message_agent')),
    tool('stop_agent', d.stop_agent, i.stop_agent.shape, run(handler, 'stop_agent')),
    tool('agent_status', d.agent_status, i.agent_status.shape, run(handler, 'agent_status')),
    tool(
      'request_review',
      d.request_review,
      i.request_review.shape,
      run(handler, 'request_review'),
    ),
    tool('submit_plan', d.submit_plan, i.submit_plan.shape, run(handler, 'submit_plan')),
  ];
}

/** The in-process MCP server given to the lead agent only (`mcpServers.acp`). */
export function createLeadToolServer(handler: LeadToolHandler): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: LEAD_MCP_SERVER_NAME,
    version: '1.0.0',
    tools: leadToolDefinitions(handler),
    alwaysLoad: true,
  });
}
