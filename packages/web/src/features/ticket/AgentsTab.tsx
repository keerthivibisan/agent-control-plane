import type { AgentRunDto, CheckRunDto, RunDetailDto, TicketDetailDto } from '@acp/core/api';
import { motion } from 'motion/react';
import type { RefObject } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { enter, slideInRight } from '../../components/motion';
import { TICKET_COPY, TICKET_PAGE_COPY } from '../../lib/copy';
import { canChat, closedByEngine } from '../control/run-state';
import { AgentCanvas } from './AgentCanvas';
import { LiveWorkflow } from './LiveWorkflow';
import type { AgentReview } from './run-data';
import { SidePanel, type PanelTab } from './SidePanel';
import { agentBranch, chatAgent, pendingByAgent } from './ticket-state';
import { AgentsIcon } from './icons';

const C = TICKET_COPY;

/** The agent the panel opens on: the one you chat with now (planner or lead), else the first. */
function defaultAgent(run: RunDetailDto): AgentRunDto | undefined {
  const chat = chatAgent(run);
  return run.agents.find((a) => a.id === chat?.id) ?? run.agents[0];
}

/**
 * The Agents tab (v0.3.0 D-B): the run's live workflow graph, then the agent tree with the selected
 * agent's side panel (chat, activity, changes, checks, approvals, details) beside it on wide
 * screens and under it on narrow ones.
 */
export function AgentsTab({
  detail,
  run,
  isCurrent,
  reviews,
  checks,
  selectedId,
  onSelect,
  panelTab,
  onPanelTab,
  draft,
  onDraft,
  chatInput,
}: {
  detail: TicketDetailDto;
  run: RunDetailDto | undefined;
  isCurrent: boolean;
  reviews: readonly AgentReview[];
  checks: readonly CheckRunDto[];
  selectedId: string | null;
  onSelect: (agentId: string, tab?: PanelTab) => void;
  panelTab: PanelTab;
  onPanelTab: (tab: PanelTab) => void;
  /** The chat's unsent text, kept on the page so it survives a visit to another tab. */
  draft: string;
  onDraft: (text: string) => void;
  chatInput: RefObject<HTMLTextAreaElement | null>;
}) {
  if (run === undefined) {
    return (
      <EmptyState
        icon={<AgentsIcon size={20} />}
        title={TICKET_PAGE_COPY.tabs.agents}
        text={TICKET_PAGE_COPY.agents.noRun}
      />
    );
  }
  const reviewOf = new Map(reviews.map((r) => [r.agentRunId, r]));
  const branches = new Map<string, string>();
  for (const a of run.agents) {
    const branch = agentBranch(a, reviewOf.get(a.id));
    if (branch !== null) branches.set(a.id, branch);
  }
  const selected = run.agents.find((a) => a.id === selectedId) ?? defaultAgent(run);
  const planning = run.status === 'PLANNING' || run.status === 'QUEUED';
  const reviewerComments = detail.comments.filter(
    (c) => c.author === 'reviewer' && c.runId === run.id,
  ).length;

  return (
    <div className="flex flex-col gap-5" data-testid="agents-tab">
      <LiveWorkflow
        run={run}
        projectId={detail.ticket.projectId}
        reviewerComments={reviewerComments}
        onSelectAgent={(id, stage) => onSelect(id, stage === 'review' ? 'changes' : undefined)}
      />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <AgentCanvas
            agents={run.agents}
            runId={run.id}
            selectedId={selected?.id ?? null}
            onSelect={(id) => onSelect(id)}
            canMessage={isCurrent && canChat(run.status)}
            pending={pendingByAgent(run)}
            branches={branches}
            chatAgentId={chatAgent(run)?.id ?? null}
            finished={new Set(run.agents.filter((a) => closedByEngine(a, run)).map((a) => a.id))}
            note={planning ? C.canvas.planning : undefined}
          />
        </div>
        {selected ? (
          // Sticky under the top bar; slides in once when the tab opens.
          <motion.div
            className="min-w-0 xl:sticky xl:top-[calc(var(--spacing-topbar)+1.25rem)]"
            {...enter(slideInRight)}
          >
            <SidePanel
              run={run}
              agent={selected}
              tab={panelTab}
              onTab={onPanelTab}
              review={reviewOf.get(selected.id)}
              checks={checks}
              comments={detail.comments}
              draft={draft}
              onDraft={onDraft}
              chatInput={chatInput}
            />
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}
