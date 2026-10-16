import { stagesUsingAgent, type ProjectWorkflow, type WorkflowStageId } from '@acp/core';
import type { AgentDefinitionSummaryDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { ErrorNotice } from '../../components/ErrorNotice';
import { workflowPaths, workflowSchemas } from '../../lib/api';
import { STAGE_AGENT_COPY, WORKFLOW_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';

const C = WORKFLOW_COPY.agents;
const AF = STAGE_AGENT_COPY;

/** The stages that use this file, as chips that open the stage's panel. */
function UsedBy({
  stages,
  onSelect,
}: {
  stages: readonly WorkflowStageId[];
  onSelect: (stage: WorkflowStageId) => void;
}) {
  if (stages.length === 0) {
    return (
      <span className="text-caption text-dim" data-testid="agent-used-by" data-used="none">
        {AF.notUsed}
      </span>
    );
  }
  return (
    <ul
      className="flex flex-wrap gap-1.5"
      aria-label={AF.usedBy}
      data-testid="agent-used-by"
      data-used={stages.join(' ')}
    >
      {stages.map((s) => (
        <li key={s}>
          <button
            type="button"
            onClick={() => onSelect(s)}
            aria-label={AF.selectStage(WORKFLOW_COPY.stages[s])}
            className="rounded-full border border-accent/30 bg-accent-soft px-2 py-px text-caption font-medium text-accent hover:border-accent/60"
          >
            {WORKFLOW_COPY.stages[s]}
          </button>
        </li>
      ))}
    </ul>
  );
}

function AgentRow({
  agent,
  usedBy,
  onSelect,
}: {
  agent: AgentDefinitionSummaryDto;
  usedBy: readonly WorkflowStageId[];
  onSelect: (stage: WorkflowStageId) => void;
}) {
  return (
    <li
      className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0"
      data-testid={`agent-file-${agent.name}`}
    >
      <span className="min-w-0 truncate font-mono font-medium" title={agent.path}>
        {agent.name}
      </span>
      {agent.description ? (
        <p className="line-clamp-2 text-caption text-dim">{agent.description}</p>
      ) : null}
      <p className="text-caption text-dim">
        {agent.model ?? WORKFLOW_COPY.projectDefault} ·{' '}
        {agent.tools === null ? C.allTools : C.tools(agent.tools.length)}
      </p>
      <UsedBy stages={usedBy} onSelect={onSelect} />
      {agent.problems.map((p) => (
        <p key={p} className="text-caption text-warning">
          ⚠ {p}
        </p>
      ))}
    </li>
  );
}

/**
 * The project's agent definition files (ADR-0018 amendment) and the stages that use each one
 * (ADR-0019 §6), from `workflow` (the page's draft, like the graph). The list is R-D's route; while
 * it isn't served (404), the card is hidden rather than shown as an error.
 */
export function AgentFiles({
  projectId,
  workflow,
  onSelect,
}: {
  projectId: string;
  workflow: ProjectWorkflow;
  onSelect: (stage: WorkflowStageId) => void;
}) {
  const q = useApiQuery(workflowPaths.agents(projectId), workflowSchemas.agents);
  if (q.error?.kind === 'http' && q.error.status === 404) return null;
  if (q.data === undefined && q.error === null) return null;
  return (
    <Card title={C.title} tip={C.tip} description={C.description} testId="agent-files">
      {q.data === undefined ? (
        q.error ? (
          <ErrorNotice error={q.error} />
        ) : null
      ) : q.data.length === 0 ? (
        <p className="text-dim">{C.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line" aria-label={C.title}>
          {q.data.map((a) => (
            <AgentRow
              key={a.name}
              agent={a}
              usedBy={stagesUsingAgent(workflow, a.name)}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
