import type { BoardDto, TicketCardDto } from '@acp/core/api';
import { useState } from 'react';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { HarnessIcon, TokensIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { boardPaths, boardSchemas, moveTicket, startTicket } from '../../lib/api';
import { BOARD_COPY, STAGE_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { ActionError } from '../control/bits';
import { useBoardAction } from './actions';
import { BoardColumns } from './BoardColumns';
import { Dialog } from './Dialog';
import { BoardIcon, PlusIcon } from './icons';
import { boardColumns, moveRequest, ticketCount, type MoveTarget } from './moves';
import { NewTicketDialog } from './NewTicketDialog';

const C = BOARD_COPY;

/**
 * "2 running · 1 needs you": the board's one live line (docs/redesign/README.md §4.1). The token
 * tiles and the harness state have their own pages now, linked from the header.
 */
export function LiveLine({ stats }: { stats: BoardDto['stats'] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="board-counts">
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`inline-block size-2 rounded-full ${stats.runningRuns > 0 ? 'bg-status-active ring-3 ring-status-active/20' : 'bg-status-stale'}`}
        />
        {C.stats.running(stats.runningRuns)}
      </span>
      <span aria-hidden="true">·</span>
      <span className={stats.needsYou > 0 ? 'font-medium text-warning' : ''}>
        {C.stats.needsYou(stats.needsYou)}
      </span>
    </span>
  );
}

type Feedback = { tone: 'ok'; text: string } | null;

function Board({ projectId }: { projectId: string }) {
  const board = useApiQuery(boardPaths.board(projectId), boardSchemas.board);
  const move = useBoardAction(moveTicket);
  const start = useBoardAction(startTicket);
  const [creating, setCreating] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<TicketCardDto | null>(null);
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
              <TokensIcon size={16} />
              {C.links.tokens}
            </ButtonLink>
            <ButtonLink href={href.projectPage(projectId, 'harness')} variant="quiet">
              <HarnessIcon size={16} />
              {C.links.harness}
            </ButtonLink>
            <Button variant="primary" onClick={() => setCreating(true)} disabled={!loaded}>
              <PlusIcon size={16} />
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
            {ticketCount(b) === 0 ? (
              <Card className="mb-6">
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
              </Card>
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
