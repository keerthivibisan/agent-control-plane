import {
  approvalsOf,
  DEFAULT_MANAGED_PROVIDER,
  deriveRoles,
  type ProjectAgentSetup,
  type WorkflowGraphV3,
} from '@acp/core';
import {
  ASSISTANT_TOOL_ANSWER_BYTES,
  type HarnessStatusDto,
  type TicketCardDto,
  type TicketDetailDto,
} from '@acp/core/api';
import type { BoardService } from '../board/service.js';
import type { AgentsService, ProjectRef, SkillsService } from '../skills/index.js';

/**
 * The assistant's read-only tools answered from ACP's own data (ADR-0035 §3): `ticket_status`
 * from the board, `project_info` from the setup, workflow, harness and the Skills & Agents
 * listings. Answers are plain text for the model, at most `ASSISTANT_TOOL_ANSWER_BYTES`, cut with a
 * note. They never include comments, chat or plan text; ticket titles and agent roles are the
 * owner's own board data.
 */

export const ANSWER_CUT_NOTE =
  '[Answer cut at 8 KiB. Ask about one ticket (ticketKey) or a narrower question for the rest.]';

/** `text` at most `maxBytes` UTF-8 bytes, never cut inside a character, with a note when cut. */
export function capAnswer(text: string, maxBytes = ASSISTANT_TOOL_ANSWER_BYTES): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  const room = maxBytes - Buffer.byteLength(`\n${ANSWER_CUT_NOTE}`, 'utf8');
  let end = Math.max(0, room);
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString('utf8')}\n${ANSWER_CUT_NOTE}`;
}

export interface AssistantToolSources {
  board: Pick<BoardService, 'listTickets' | 'ticket' | 'getSetup' | 'harnessStatus'>;
  workflowOf: (projectId: string) => Promise<{ graph: WorkflowGraphV3 }>;
  skills: Pick<SkillsService, 'list'>;
  agents: Pick<AgentsService, 'list'>;
}

const OPEN_STATUSES: readonly string[] = ['BACKLOG', 'READY', 'ACTIVE'];

/** One line, without line breaks: titles and labels stay on their row. */
function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function describeTicket(card: TicketCardDto, detail: TicketDetailDto | null): string {
  const lines = [`${card.key} · ${oneLine(card.title)} · stage ${card.stage}`];
  if (card.needsYou > 0) lines.push(`  Waiting for the owner: ${card.needsYou}`);
  if (card.lastRunOutcome !== null) lines.push(`  Last run: ${card.lastRunOutcome}`);
  const run = detail?.currentRun ?? null;
  if (run === null) {
    lines.push('  No current run.');
    return lines.join('\n');
  }
  lines.push(`  Current run: ${run.status}`);
  const plan = detail?.plans.find((p) => p.runId === run.id) ?? detail?.plans[0];
  if (plan !== undefined) lines.push(`  Plan: ${plan.steps.length} steps, ${plan.status}`);
  for (const agent of run.agents) {
    const activity =
      agent.latestActivity === null ? '' : `, latest: ${oneLine(agent.latestActivity, 100)}`;
    lines.push(
      `  - ${oneLine(agent.role, 60)} (${agent.kind}, ${agent.provider ?? DEFAULT_MANAGED_PROVIDER}): ${agent.status}${activity}`,
    );
  }
  const waiting = run.approvals.filter((a) => a.status === 'pending');
  for (const approval of waiting)
    lines.push(`  Approval waiting: ${oneLine(approval.summary, 200)}`);
  return lines.join('\n');
}

/**
 * `ticket_status`: one ticket by key (any status), or every open ticket (backlog, ready, active).
 * Throws with a short sentence for an unknown key.
 */
export function ticketStatusAnswer(
  sources: AssistantToolSources,
  projectId: string,
  ticketKey: string | undefined,
): string {
  const cards = sources.board.listTickets(projectId);
  const detailOf = (card: TicketCardDto): TicketDetailDto | null =>
    card.currentRunId === null ? null : sources.board.ticket(card.id);
  if (ticketKey !== undefined) {
    const key = ticketKey.trim().toUpperCase();
    const card = cards.find((c) => c.key === key);
    if (card === undefined) throw new Error(`There is no ticket ${key} in this project.`);
    return capAnswer(describeTicket(card, detailOf(card)));
  }
  const open = cards.filter((c) => OPEN_STATUSES.includes(c.status));
  if (open.length === 0) return 'No open tickets in this project.';
  const body = open.map((card) => describeTicket(card, detailOf(card))).join('\n');
  return capAnswer(`${open.length} open tickets:\n${body}`);
}

function setupLines(setup: ProjectAgentSetup): string[] {
  return [
    'Settings:',
    `  Provider: ${setup.provider ?? DEFAULT_MANAGED_PROVIDER}`,
    `  Model: ${setup.model ?? 'the provider default'}`,
    `  Approval mode: ${approvalsOf(setup).mode}`,
    `  Ticket key: ${setup.projectKey}`,
    `  Helpers at once: ${setup.maxConcurrentHelpers}; budget per agent: ${setup.defaultBudgetTokensPerAgent} tokens`,
  ];
}

function workflowLines(graph: WorkflowGraphV3): string[] {
  const lines = ['Workflow nodes:'];
  // ADR-0037: an agent block's role comes from its arrows.
  const roles = deriveRoles(graph);
  for (const node of graph.nodes) {
    if (node.type !== 'agent' && node.type !== 'lead') {
      lines.push(`  - ${node.id} (${node.type}): ${oneLine(node.label, 60)}`);
      continue;
    }
    const derived = roles.get(node.id);
    const type =
      node.type === 'agent' && derived?.ok === true ? `agent, ${derived.role.role}` : node.type;
    const parts = [
      `model ${node.model ?? 'default'}`,
      ...(node.provider !== undefined ? [`provider ${node.provider}`] : []),
      ...(node.effort !== undefined ? [`effort ${node.effort}`] : []),
      ...(node.skills.length > 0 ? [`skills ${node.skills.join(', ')}`] : []),
      ...(node.agent !== null ? [`agent ${node.agent}`] : []),
    ];
    lines.push(`  - ${node.id} (${type}): ${oneLine(node.label, 60)}; ${parts.join('; ')}`);
  }
  return lines;
}

function harnessLines(harness: HarnessStatusDto): string[] {
  const lines = [`Harness checks (${harness.state}):`];
  if (harness.checks.length === 0) lines.push('  none');
  for (const check of harness.checks) {
    lines.push(
      `  - ${check.id}: ${oneLine(check.name, 80)} (${check.required ? 'required' : 'optional'}; ${check.argv.join(' ').slice(0, 120)})`,
    );
  }
  return lines;
}

/** `project_info`: the project's settings, workflow, harness checks, skills and agents. */
export async function projectInfoAnswer(
  sources: AssistantToolSources,
  project: ProjectRef,
): Promise<string> {
  const sections: string[] = [];
  sections.push(setupLines(await sources.board.getSetup(project.id)).join('\n'));
  sections.push(workflowLines((await sources.workflowOf(project.id)).graph).join('\n'));
  try {
    sections.push(harnessLines(await sources.board.harnessStatus(project.id)).join('\n'));
  } catch {
    sections.push('Harness checks: could not be read.');
  }
  const listed = async (
    title: string,
    list: () => Promise<{ name: string; description: string }[]>,
  ): Promise<string> => {
    try {
      const entries = await list();
      if (entries.length === 0) return `${title}: none`;
      return [
        `${title}:`,
        ...entries.map(
          (e) => `  - ${e.name}: ${oneLine(e.description, 200) || '(no description)'}`,
        ),
      ].join('\n');
    } catch {
      // A symlinked or unreadable folder: the writer refuses it, and so does this listing.
      return `${title}: the folder could not be read safely.`;
    }
  };
  sections.push(await listed('Skills (.claude/skills)', () => sources.skills.list(project)));
  sections.push(
    await listed('Agent definitions (.claude/agents)', () => sources.agents.list(project)),
  );
  return capAnswer(sections.join('\n\n'));
}
