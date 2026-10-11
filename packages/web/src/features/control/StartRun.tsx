import { DEFAULT_AGENT_BUDGET_TOKENS } from '@acp/core';
import { useId, useState, type FormEvent } from 'react';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { EmptyState } from '../../components/EmptyState';
import { InfoTip } from '../../components/InfoTip';
import { QueryView } from '../../components/QueryView';
import { paths, schemas, sendChat, startRun, type StartRunRequest } from '../../lib/api';
import { CONTROL_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href, navigate } from '../../lib/router';
import { useControlAction } from './actions';
import { ActionError } from './bits';

const C = CONTROL_COPY.start;

/**
 * A first message the run started with but couldn't send: the run page puts it back in the chat
 * box instead of losing what the owner wrote.
 */
export const unsentFirstMessages = new Map<string, string>();

function budgetSummary(raw: string): string {
  const n = Number(raw.replace(/[,\s_]/g, ''));
  return Number.isSafeInteger(n) && n > 0
    ? `${C.budget}: ${formatCount(n)} budget tokens`
    : C.budget;
}

const fieldClass =
  'rounded-control border border-line-strong bg-panel px-3 py-2 text-ink placeholder:text-dim/70';

/** Shown when no run is open: pick a project, say what to do, start (POST /api/runs). */
export function StartRun() {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const start = useControlAction(startRun);
  const chat = useControlAction(sendChat);
  const [projectId, setProjectId] = useState('');
  const [task, setTask] = useState('');
  const [budget, setBudget] = useState(String(DEFAULT_AGENT_BUDGET_TOKENS));
  const [errors, setErrors] = useState<{ project?: string; budget?: string }>({});
  const ids = { project: useId(), task: useId(), budget: useId() };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const tokens = Number(budget.replace(/[,\s_]/g, ''));
    const next: typeof errors = {};
    if (projectId === '') next.project = C.projectMissing;
    if (!Number.isSafeInteger(tokens) || tokens <= 0) next.budget = C.budgetInvalid;
    setErrors(next);
    if (next.project || next.budget) return;

    const input: StartRunRequest = { projectId };
    // Left out when unchanged, so the server's default applies.
    if (tokens !== DEFAULT_AGENT_BUDGET_TOKENS) {
      input.budget = { maxTokensPerAgent: tokens, softCostUsdPerRun: null };
    }
    const run = await start.run(input);
    if (run === null) return;
    const text = task.trim();
    if (text.length > 0) {
      const sent = await chat.run(run.id, { text });
      if (sent === null) unsentFirstMessages.set(run.id, text);
    }
    navigate(href.control(run.id));
  };

  const pending = start.pending || chat.pending;
  return (
    <Card title={C.title} description={C.description} testId="start-run">
      <QueryView query={projects}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              compact
              title={C.noProjects.title}
              text={C.noProjects.text}
              action={
                <ButtonLink href={href.setup()} variant="primary">
                  {C.noProjects.action}
                </ButtonLink>
              }
            />
          ) : (
            <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.project} className="font-medium">
                  {C.project}
                </label>
                <select
                  id={ids.project}
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  aria-invalid={errors.project ? true : undefined}
                  className={`${fieldClass} ${errors.project ? 'border-danger' : ''}`}
                >
                  <option value="">{C.chooseProject}</option>
                  {list.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span className="text-caption text-dim">{C.projectHint}</span>
                {errors.project ? (
                  <span role="alert" className="text-caption text-danger">
                    {errors.project}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.task} className="font-medium">
                  {C.task}
                </label>
                <textarea
                  id={ids.task}
                  rows={4}
                  value={task}
                  maxLength={8000}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder={C.taskPlaceholder}
                  className={`${fieldClass} resize-y`}
                />
                <span className="text-caption text-dim">{C.taskHint}</span>
              </div>
              <Details summary={budgetSummary(budget)}>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1">
                    <label htmlFor={ids.budget} className="font-medium">
                      {C.budget}
                    </label>
                    <InfoTip
                      tip={CONTROL_COPY.terms.budget.tip}
                      label={CONTROL_COPY.terms.budget.term}
                    />
                  </span>
                  <input
                    id={ids.budget}
                    inputMode="numeric"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    aria-invalid={errors.budget ? true : undefined}
                    className={`${fieldClass} max-w-60 tabular-nums ${errors.budget ? 'border-danger' : ''}`}
                  />
                  <span className="text-caption text-dim">{C.budgetHint}</span>
                  {errors.budget ? (
                    <span role="alert" className="text-caption text-danger">
                      {errors.budget}
                    </span>
                  ) : null}
                </div>
              </Details>
              <ActionError error={start.error} message={C.failed} />
              <div>
                <Button type="submit" variant="primary" disabled={pending}>
                  {pending ? C.starting : C.submit}
                </Button>
              </div>
            </form>
          )
        }
      </QueryView>
    </Card>
  );
}
