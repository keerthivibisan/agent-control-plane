import type { BoardDto, TicketCardDto } from '@acp/core/api';
import { useState } from 'react';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { HarnessIcon, TokensIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { Skeleton } from '../../components/Skeleton';
import {
  boardPaths,
  boardSchemas,
  moveTicket,
  startTicket,
  type StartTicketRequest,
} from '../../lib/api';
import { BOARD_COPY, STAGE_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { ActionError } from '../control/bits';
import { useBoardAction } from './actions';
import { BoardColumns } from './BoardColumns';
import { BoardIcon, CheckCircleIcon, PlusIcon } from './icons';
import { StartDialog } from '../review-loop/StartDialog';
import { boardColumns, moveRequest, ticketCount, type BoardPick, type MoveTarget } from './moves';
import { NewTicketDialog } from './NewTicketDialog';

const C = BOARD_COPY;

/**
 * "2 running · 1 needs you": the board's one live line (docs/redesign/README.md §4.1). The token
 * tiles and the harness state have their own pages now, linked from the header.
 */
export function LiveLine({ stats }: { stats: BoardDto['stats'] }) {
  return (
    <span
      className="inline-flex flex-wrap items-center gap-2 text-dim tabular-nums"
      data-testid="board-counts"
    >
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="relative inline-flex size-2">
          {stats.runningRuns > 0 ? (
            <span className="absolute inset-0 animate-ping rounded-full bg-status-active/50 [animation-duration:2s]" />
          ) : null}
          <span
            className={`relative inline-block size-2 rounded-full ${stats.runningRuns > 0 ? 'bg-status-active' : 'bg-status-stale'}`}
          />
        </span>
        <span className={stats.runningRuns > 0 ? 'text-ink' : ''}>
          {C.stats.running(stats.runningRuns)}
        </span>
      </span>
      <span aria-hidden="true" className="text-line-strong">
        ·
      </span>
      <span
        className={`inline-flex items-center gap-1.5 ${stats.needsYou > 0 ? 'font-medium text-warning' : ''}`}
      >
        {stats.needsYou > 0 ? (
          <span aria-hidden="true" className="inline-block size-2 rounded-full bg-warning" />
        ) : null}
        {C.stats.needsYou(stats.needsYou)}
      </span>
    </span>
  );
}

/** The board's loading state: column wells with card-shaped blocks, the words for screen readers. */
function BoardSkeleton({ label }: { label: string }) {
  return (
    <div data-loading="" className="flex gap-2.5 overflow-hidden pt-1">
      <span className="sr-only">{label}</span>
      {[2, 1, 3, 1].map((cards, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex min-h-[28rem] w-[17rem] shrink-0 flex-col gap-2 rounded-card border border-line/60 bg-sunken/80 p-2"
        >
          <Skeleton className="mx-1 mt-1.5 mb-2 h-3.5 w-24" />
          {Array.from({ length: cards }, (_, j) => (
            <div
              key={j}
              className="flex flex-col gap-2.5 rounded-card border border-line bg-panel p-3"
            >
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

type Feedback = { tone: 'ok'; text: string } | null;

function Board({ projectId }: { projectId: string }) {
  const board = useApiQuery(boardPaths.board(projectId), boardSchemas.board);
  const move = useBoardAction(moveTicket);
  const start = useBoardAction(startTicket);
  const [creating, setCreating] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<TicketCardDto | null>(null);
  /** The ticket whose Start dialog is open (ADR-0021: this run's own settings). */
  const [startWith, setStartWith] = useState<TicketCardDto | null>(null);
  const startOptions = useBoardAction(startTicket);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const loaded = board.data !== undefined;

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

  const onMove = (ticket: TicketCardDto, target: BoardPick) => {
    if (target === 'START_OPTIONS') {
      startOptions.reset();
      setStartWith(ticket);
    } else if (target === 'CANCELLED') setConfirmCancel(ticket);
    else void perform(ticket, target);
  };

  /** Start from the dialog; it stays open with the server's reason if the start is refused. */
  const startWithOptions = async (ticket: TicketCardDto, request: StartTicketRequest) => {
    setFeedback(null);
    setFailed(null);
    setBusyId(ticket.id);
    const ok = (await startOptions.run(ticket.id, request)) !== null;
    setBusyId(null);
    if (!ok) return;
    setStartWith(null);
    setFeedback({ tone: 'ok', text: C.move.started(ticket.key) });
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
          <ButtonLink href={href.projects()} variant="primary">
            {C.empty.notFound.action}
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={C.page.title}
        title={board.data?.project.name ?? C.page.title}
        tip={C.page.tip}
        description={board.data ? <LiveLine stats={board.data.stats} /> : C.page.description}
        actions={
          <>
            <ButtonLink href={href.projectPage(projectId, 'tokens')} variant="quiet">
              <TokensIcon size={15} />
              {C.links.tokens}
            </ButtonLink>
            <ButtonLink href={href.projectPage(projectId, 'harness')} variant="quiet">
              <HarnessIcon size={15} />
              {C.links.harness}
            </ButtonLink>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
            <Button variant="primary" onClick={() => setCreating(true)} disabled={!loaded}>
              <PlusIcon size={15} />
              {C.newTicket}
            </Button>
          </>
        }
      />

      <p role="status" className="sr-only">
        {feedback?.text ?? ''}
      </p>
      {feedback ? (
        <p
          aria-hidden="true"
          className="mb-4 flex animate-fade-in items-center gap-2 rounded-control border border-line bg-panel px-3 py-2 text-ink shadow-card"
          data-testid="board-feedback"
        >
          <CheckCircleIcon size={15} className="shrink-0 text-success" />
          {feedback.text}
        </p>
      ) : null}
      {failed ? (
        <div className="mb-4">
          <ActionError error={move.error ?? start.error} message={failed} />
        </div>
      ) : null}

      {board.data === undefined && board.error === null ? (
        <BoardSkeleton label={C.loading} />
      ) : (
        <QueryView query={board} loading={C.loading}>
          {(b) =>
            // An empty board is the empty state alone: nine empty columns say nothing more.
            ticketCount(b) === 0 ? (
              <Card className="border-dashed bg-transparent shadow-none">
                <EmptyState
                  testId="board-empty"
                  icon={<BoardIcon size={20} />}
                  title={C.empty.noTickets.title}
                  text={C.empty.noTickets.text}
                  action={
                    <Button variant="primary" onClick={() => setCreating(true)}>
                      <PlusIcon size={16} />
                      {C.newTicket}
                    </Button>
                  }
                />
              </Card>
            ) : (
              <BoardColumns columns={boardColumns(b)} busyId={busyId} onMove={onMove} />
            )
          }
        </QueryView>
      )}

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

      {startWith ? (
        <StartDialog
          projectId={projectId}
          ticketKey={startWith.key}
          ticketOptions={startWith.runOptions}
          kind="start"
          pending={startOptions.pending}
          error={startOptions.error}
          onStart={(request) => void startWithOptions(startWith, request)}
          onClose={() => setStartWith(null)}
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
            <Button
              variant="danger"
              onClick={() => {
                const ticket = confirmCancel;
                setConfirmCancel(null);
                void perform(ticket, 'CANCELLED');
              }}
            >
              {C.cancel.confirm}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * `#/p/:projectId/board` (docs/redesign/README.md §4.1): one project's tickets in columns by stage.
 * The project comes from the address; the top bar's switcher is the only project picker.
 */
export function BoardPage({ projectId }: { projectId: string }) {
  return <Board key={projectId} projectId={projectId} />;
}
