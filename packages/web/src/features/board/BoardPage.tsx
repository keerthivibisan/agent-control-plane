import type { ProjectDto, TicketCardDto } from '@acp/core/api';
import { useEffect, useId, useState } from 'react';
import { Button, ButtonLink } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { QueryView } from '../../components/QueryView';
import { boardPaths, boardSchemas, moveTicket, paths, schemas, startTicket } from '../../lib/api';
import { BOARD_COPY, STAGE_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href, navigate } from '../../lib/router';
import { ActionError } from '../control/bits';
import { useBoardAction } from './actions';
import { BoardColumns } from './BoardColumns';
import { BoardStats } from './BoardStats';
import { Dialog } from './Dialog';
import { BoardIcon, GearIcon, PlusIcon } from './icons';
import { defaultProjectId, readLastProject, rememberProject } from './last-project';
import { boardColumns, moveRequest, ticketCount, type MoveTarget } from './moves';
import { NewTicketDialog } from './NewTicketDialog';

const C = BOARD_COPY;

/**
 * Pages P4-F adds (README §5.4–5.5). Plain hashes here so this WP doesn't edit P4-F's router
 * entries; the coordinator can switch them to `href` helpers once both are merged.
 */
const projectSetupHash = (id: string) => `#/projects/${encodeURIComponent(id)}/settings`;
const NEW_PROJECT_HASH = '#/projects/new';

function ProjectSwitcher({ projects, current }: { projects: ProjectDto[]; current: string }) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {C.switcher.label}
      </label>
      <select
        id={id}
        value={current}
        onChange={(e) => navigate(href.board(e.target.value))}
        className="max-w-72 truncate rounded-control border border-line-strong bg-panel py-1 pr-8 pl-3 text-title font-semibold text-ink"
      >
        {projects.some((p) => p.id === current) ? null : <option value={current}>…</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </span>
  );
}

type Feedback = { tone: 'ok'; text: string } | null;

function Board({ projectId, projects }: { projectId: string; projects: ProjectDto[] }) {
  const board = useApiQuery(boardPaths.board(projectId), boardSchemas.board);
  const move = useBoardAction(moveTicket);
  const start = useBoardAction(startTicket);
  const [creating, setCreating] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<TicketCardDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const loaded = board.data !== undefined;
  useEffect(() => {
    if (loaded) rememberProject(projectId);
  }, [loaded, projectId]);

  const perform = async (ticket: TicketCardDto, target: MoveTarget) => {
    setFeedback(null);
    setFailed(null);
    move.reset();
    start.reset();
    setBusyId(ticket.id);
    const request = moveRequest(target);
    const ok =
      request.kind === 'start'
        ? (await start.run(ticket.id)) !== null
        : (await move.run(ticket.id, { status: request.status })) !== null;
    setBusyId(null);
    if (!ok) {
      setFailed(
        request.kind === 'start' ? C.move.startFailed(ticket.key) : C.move.failed(ticket.key),
      );
      return;
    }
    setFeedback({
      tone: 'ok',
      text:
        request.kind === 'start'
          ? C.move.started(ticket.key)
          : target === 'CANCELLED'
            ? C.move.cancelled(ticket.key)
            : C.move.moved(ticket.key, STAGE_COPY[target].word),
    });
  };

  const onMove = (ticket: TicketCardDto, target: MoveTarget) => {
    if (target === 'CANCELLED') setConfirmCancel(ticket);
    else void perform(ticket, target);
  };

  // Only a real "no such project" answer; an unknown route (an older server) is a plain error.
  if (
    board.data === undefined &&
    board.error?.kind === 'http' &&
    board.error.status === 404 &&
    board.error.code === 'not_found'
  ) {
    return (
      <EmptyState
        title={C.empty.notFound.title}
        text={C.empty.notFound.text}
        action={
          <ButtonLink href={href.board()} variant="primary">
            {C.page.title}
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-page font-semibold tracking-tight">
            <span>{C.page.title}</span>
            <span aria-hidden="true" className="text-title text-dim">
              ▸
            </span>
            <ProjectSwitcher projects={projects} current={projectId} />
          </h1>
          <p className="mt-1 max-w-3xl text-dim">{C.page.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setCreating(true)} disabled={!loaded}>
            <PlusIcon size={16} />
            {C.newTicket}
          </Button>
          <ButtonLink href={projectSetupHash(projectId)}>
            <GearIcon size={16} />
            {C.setup}
          </ButtonLink>
          <ButtonLink href={NEW_PROJECT_HASH} variant="quiet">
            {C.newProject}
          </ButtonLink>
        </div>
      </header>

      <p role="status" className="sr-only">
        {feedback?.text ?? ''}
      </p>
      {feedback ? (
        <p
          aria-hidden="true"
          className="mb-4 rounded-control border border-line bg-panel px-3 py-2 text-dim"
          data-testid="board-feedback"
        >
          {feedback.text}
        </p>
      ) : null}
      {failed ? (
        <div className="mb-4">
          <ActionError error={move.error ?? start.error} message={failed} />
        </div>
      ) : null}

      <QueryView query={board} loading={C.loading}>
        {(b) => (
          <>
            <BoardStats board={b} />
            {ticketCount(b) === 0 ? (
              <div className="mb-5 rounded-card border border-line bg-panel shadow-card">
                <EmptyState
                  compact
                  testId="board-empty"
                  icon={<BoardIcon size={18} />}
                  title={C.empty.noTickets.title}
                  text={C.empty.noTickets.text}
                  action={
                    <Button variant="primary" onClick={() => setCreating(true)}>
                      <PlusIcon size={16} />
                      {C.newTicket}
                    </Button>
                  }
                />
              </div>
            ) : null}
            <BoardColumns columns={boardColumns(b)} busyId={busyId} onMove={onMove} />
          </>
        )}
      </QueryView>

      {creating ? (
        <NewTicketDialog
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            setFailed(null);
            setFeedback({ tone: 'ok', text: C.dialog.created(t.key) });
          }}
        />
      ) : null}

      {confirmCancel ? (
        <Dialog
          title={C.cancel.title(confirmCancel.key)}
          description={C.cancel.text}
          onClose={() => setConfirmCancel(null)}
          testId="confirm-cancel"
        >
          <div className="flex justify-end gap-2">
            <Button data-autofocus onClick={() => setConfirmCancel(null)}>
              {C.cancel.keep}
            </Button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-control border border-danger/40 bg-danger-soft px-3 py-1.5 font-medium text-danger transition-colors hover:border-danger"
              onClick={() => {
                const ticket = confirmCancel;
                setConfirmCancel(null);
                void perform(ticket, 'CANCELLED');
              }}
            >
              {C.cancel.confirm}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * `#/board` and `#/board/:projectId` (Phase 4, README §5.1–5.2): one project's tickets in columns
 * by stage. Without an id it opens the last used project, else the first.
 */
export function BoardPage({ projectId }: { projectId: string | null }) {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  return (
    <QueryView query={projects} loading={C.loading}>
      {(list) => {
        const id = projectId ?? defaultProjectId(list, readLastProject());
        if (id === null) {
          return (
            <div>
              <header className="mb-6">
                <h1 className="text-page font-semibold tracking-tight">{C.page.title}</h1>
                <p className="mt-1 max-w-3xl text-dim">{C.page.description}</p>
              </header>
              <EmptyState
                testId="board-no-projects"
                icon={<BoardIcon size={22} />}
                title={C.empty.noProjects.title}
                text={C.empty.noProjects.text}
                action={
                  <ButtonLink href={NEW_PROJECT_HASH} variant="primary">
                    {C.newProject}
                  </ButtonLink>
                }
              />
            </div>
          );
        }
        return <Board key={id} projectId={id} projects={list} />;
      }}
    </QueryView>
  );
}
