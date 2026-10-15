import type { BoardDto } from '@acp/core/api';
import { InfoTip } from '../../components/InfoTip';
import { TokenValue } from '../../components/TokenValue';
import {
  BOARD_COPY,
  GLOSSARY,
  HARNESS_STATE_COPY,
  TOKEN_TYPES,
  type HarnessStateCopy,
} from '../../lib/copy';
import { TOKEN_TYPE_COLOR } from '../../lib/tokens';

const C = BOARD_COPY;

const HARNESS_DOT: Record<HarnessStateCopy['tone'], string> = {
  ok: 'bg-status-active',
  partial: 'bg-status-idle',
  problem: 'bg-danger',
  none: 'border-2 border-status-stale bg-transparent',
};

export function HarnessBadge({ harness }: { harness: BoardDto['harness'] }) {
  const s = HARNESS_STATE_COPY[harness.state];
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-testid="harness"
      data-state={harness.state}
    >
      <span className="text-dim">{C.harness.term}:</span>
      <span
        aria-hidden="true"
        className={`inline-block size-2 rounded-full ${HARNESS_DOT[s.tone]}`}
      />
      <span className="font-medium">{s.word}</span>
      <InfoTip tip={`${s.tip} ${C.harness.tip}`} label={`${C.harness.term} ${s.word}`} />
    </span>
  );
}

/**
 * The strip under the board title (README §5.2): harness, running and waiting counts, the last 7
 * days of tokens by type (side by side, never added up), and where the estimated cost lives. There
 * is deliberately no board-wide cost: provider-reported costs are per run and never summed.
 */
export function BoardStats({ board }: { board: BoardDto }) {
  const { stats } = board;
  return (
    <div
      data-testid="board-stats"
      className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card border border-line bg-panel px-5 py-3 shadow-card"
    >
      <HarnessBadge harness={board.harness} />
      <span className="inline-flex items-center gap-2" data-testid="board-counts">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`inline-block size-2 rounded-full ${stats.runningRuns > 0 ? 'bg-status-active ring-3 ring-status-active/20' : 'bg-status-stale'}`}
          />
          {C.stats.running(stats.runningRuns)}
        </span>
        <span aria-hidden="true" className="text-dim">
          ·
        </span>
        <span className={stats.needsYou > 0 ? 'font-medium text-warning' : ''}>
          {C.stats.needsYou(stats.needsYou)}
        </span>
      </span>
      <span className="hidden h-5 w-px bg-line xl:inline-block" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="board-tokens">
        <span className="inline-flex items-center gap-0.5 text-dim">
          {C.stats.tokens}
          <InfoTip tip={C.stats.tokensTip} label={C.stats.tokens} />
        </span>
        {TOKEN_TYPES.map((t) => (
          <span key={t.key} className="inline-flex items-center gap-1.5" data-token={t.key}>
            <span
              aria-hidden="true"
              className={`inline-block size-2 rounded-sm ${TOKEN_TYPE_COLOR[t.key].bg}`}
            />
            <TokenValue value={stats.tokensLast7Days[t.key]} type={t.key} compact />
          </span>
        ))}
      </div>
      <span className="inline-flex items-center gap-1 text-caption text-dim">
        {C.stats.cost}: {C.stats.costNote}
        <InfoTip tip={GLOSSARY.estimatedCost.tip} label={GLOSSARY.estimatedCost.term} />
      </span>
    </div>
  );
}
