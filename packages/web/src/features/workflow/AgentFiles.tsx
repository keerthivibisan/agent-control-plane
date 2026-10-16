import type { AgentDefinitionSummaryDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Pill } from '../../components/Pill';
import { workflowPaths, workflowSchemas } from '../../lib/api';
import { WORKFLOW_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';

const C = WORKFLOW_COPY.agents;

function AgentRow({ agent }: { agent: AgentDefinitionSummaryDto }) {
  return (
    <li
      className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
      data-testid={`agent-file-${agent.name}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono font-medium" title={agent.path}>
          {agent.name}
        </span>
        <Pill tone="neutral" dot={false}>
          {C.notMapped}
        </Pill>
      </div>
      {agent.description ? (
        <p className="line-clamp-2 text-caption text-dim">{agent.description}</p>
      ) : null}
      <p className="text-caption text-dim">
        {agent.model ?? WORKFLOW_COPY.projectDefault} ·{' '}
        {agent.tools === null ? C.allTools : C.tools(agent.tools.length)}
      </p>
      {agent.problems.map((p) => (
        <p key={p} className="text-caption text-warning">
          ⚠ {p}
        </p>
      ))}
    </li>
  );
}

/**
 * The project's agent definition files (ADR-0018 amendment), listed as "available, not mapped":
 * mapping a stage to one is a later decision. The list is R-D's route; while it isn't served
 * (404), the card is hidden rather than shown as an error.
 */
export function AgentFiles({ projectId }: { projectId: string }) {
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
            <AgentRow key={a.name} agent={a} />
          ))}
        </ul>
      )}
    </Card>
  );
}
