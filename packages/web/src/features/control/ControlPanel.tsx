import type { AgentRunDto, RunDetailDto } from '@acp/core/api';
import { useEffect, useRef, useState } from 'react';
import { ButtonLink } from '../../components/Button';
import { Details } from '../../components/Details';
import { EmptyState } from '../../components/EmptyState';
import { InfoTip } from '../../components/InfoTip';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { RelativeTime } from '../../components/RelativeTime';
import { controlPaths, controlSchemas, paths, schemas, stopRun } from '../../lib/api';
import { CONTROL_COPY, RUN_STATUS_COPY } from '../../lib/copy';
import { formatCount, formatUsd } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { useControlAction } from './actions';
import { AgentTree } from './AgentTree';
import { Approvals } from './Approvals';
import { ActionError, ConfirmAction, Fact, StatusWord } from './bits';
import { Chat } from './Chat';
import { ReviewPanel } from './ReviewPanel';
import { canChat, hasReview, isRunLive } from './run-state';
import { RunList } from './RunList';
import { StartRun, unsentFirstMessages } from './StartRun';

const C = CONTROL_COPY;

/** Status, project, start, budget; ids only under Technical details. */
function RunFacts({ run }: { run: RunDetailDto }) {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const project = projects.data?.find((p) => p.id === run.projectId);
  return (
    <div className="mb-6 flex flex-col gap-3" data-testid="run-facts">
      <dl className="flex flex-wrap gap-x-10 gap-y-4 rounded-card border border-line bg-panel px-5 py-4 shadow-card">
        <Fact label={C.facts.status}>
          <StatusWord status={RUN_STATUS_COPY[run.status]} value={run.status} />
        </Fact>
        <Fact label={C.facts.project}>
          {project ? (
            <a href={href.project(project.id)}>{project.name}</a>
          ) : (
            <span className="text-dim">{projects.data ? C.facts.projectMissing : '…'}</span>
          )}
        </Fact>
        <Fact label={C.facts.started}>
          <RelativeTime iso={run.createdAt} />
        </Fact>
        <Fact label={C.facts.updated}>
          <RelativeTime iso={run.updatedAt} />
        </Fact>
        <Fact
          label={
            <span className="inline-flex items-center gap-0.5">
              {C.facts.budget}
              <InfoTip tip={C.terms.budget.tip} label={C.terms.budget.term} />
            </span>
          }
        >
          <span className="tabular-nums">
            {formatCount(run.budget.maxTokensPerAgent)} budget tokens
          </span>
        </Fact>
      </dl>
      <Details summary={C.technical.summary}>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-caption">
          <dt className="text-dim">{C.technical.runId}</dt>
          <dd className="font-mono break-all">{run.id}</dd>
          <dt className="text-dim">{C.technical.costWarning}</dt>
          <dd>
            {run.budget.softCostUsdPerRun === null
              ? C.technical.noCostWarning
              : `~${formatUsd(run.budget.softCostUsdPerRun)}`}
          </dd>
          <dt className="text-dim">{C.technical.ended}</dt>
          <dd>
            <RelativeTime iso={run.endedAt} fallback={C.technical.notEnded} />
          </dd>
        </dl>
      </Details>
    </div>
  );
}

/** A note for states that ask something of the owner, in the status's own words. */
function StatusNote({ run }: { run: RunDetailDto }) {
  if (!['REVIEW', 'NEEDS_REVIEW', 'FAILED'].includes(run.status)) return null;
  const s = RUN_STATUS_COPY[run.status];
  const tone =
    s.tone === 'problem' ? 'border-danger/30 bg-danger-soft' : 'border-warning/40 bg-warning-soft';
  return (
    <p role="status" className={`mb-6 rounded-card border px-5 py-3 ${tone}`}>
      <strong className="font-semibold">{s.word}.</strong> {s.tip}
    </p>
  );
}

function StopAll({ runId }: { runId: string }) {
  const stop = useControlAction(stopRun);
  return (
    <div className="flex max-w-md flex-col items-end gap-2">
      <ConfirmAction
        label={C.stopAll.button}
        question={C.stopAll.confirm}
        confirmLabel={C.stopAll.confirmButton}
        cancelLabel={C.stopAll.keep}
        pendingLabel={C.stopAll.stopping}
        pending={stop.pending}
        onConfirm={() => stop.run(runId)}
      />
      <ActionError error={stop.error} message={C.stopAll.failed} />
    </div>
  );
}

function Run({ run }: { run: RunDetailDto }) {
  const [draft, setDraft] = useState(() => unsentFirstMessages.get(run.id) ?? '');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatOpen = canChat(run.status);
  // The unsent first message is back in the box; forget it so it isn't restored twice.
  useEffect(() => {
    unsentFirstMessages.delete(run.id);
  }, [run.id]);

  const onMessage = (agent: AgentRunDto) => {
    if (agent.kind === 'worker') {
      const prefix = C.chat.messageFor(agent.role);
      setDraft((d) => (d.startsWith(prefix) ? d : `${prefix}${d}`));
    }
    inputRef.current?.focus();
  };

  return (
    <div>
      <PageHeader
        eyebrow={<a href={href.control()}>← {C.allRuns}</a>}
        title={run.title}
        description={C.page.description}
        actions={
          isRunLive(run.status) ? (
            <StopAll runId={run.id} />
          ) : run.status === 'CANCELLING' ? (
            <span className="text-dim">{C.stopAll.stopping}</span>
          ) : (
            <ButtonLink href={href.control()}>{C.newRun}</ButtonLink>
          )
        }
      />
      <RunFacts run={run} />
      <StatusNote run={run} />
      <div className="mb-6">
        <Approvals approvals={run.approvals} agents={run.agents} />
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-2 lg:sticky lg:top-6">
          <Chat
            runId={run.id}
            messages={run.messages}
            open={chatOpen}
            draft={draft}
            onDraft={setDraft}
            inputRef={inputRef}
          />
          {chatOpen && run.agents.some((a) => a.kind === 'worker') ? (
            <p className="px-1 text-caption text-dim">{C.chat.relayNote}</p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <AgentTree
            agents={run.agents}
            runId={run.id}
            canMessage={chatOpen}
            onMessage={onMessage}
          />
          {hasReview(run) ? <ReviewPanel runId={run.id} agents={run.agents} /> : null}
        </div>
      </div>
    </div>
  );
}

function RunPage({ runId }: { runId: string }) {
  const run = useApiQuery(controlPaths.run(runId), controlSchemas.run);
  if (run.data === undefined && run.error?.kind === 'http' && run.error.status === 404) {
    return (
      <EmptyState
        title={C.notFound.title}
        text={C.notFound.text}
        action={
          <ButtonLink href={href.control()} variant="primary">
            {C.allRuns}
          </ButtonLink>
        }
      />
    );
  }
  return (
    <QueryView query={run} loading={C.loading}>
      {(r) => <Run run={r} />}
    </QueryView>
  );
}

/**
 * `#/control` and `#/control/:runId` (Phase 3 M1): start a run, then chat with the lead agent on
 * the left while its agents, their approvals and their changes appear on the right.
 */
export function ControlPanel({ runId }: { runId: string | null }) {
  if (runId !== null) return <RunPage runId={runId} />;
  return (
    <div>
      <PageHeader title={C.page.title} description={C.page.description} />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <StartRun />
        <RunList />
      </div>
    </div>
  );
}
