import type { ProjectTokensDto, TokenHeadlineDto, UsageTotalsDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { EstimatedCost } from '../../components/EstimatedCost';
import { InfoTip } from '../../components/InfoTip';
import { ProvenanceBadge } from '../../components/ProvenanceBadge';
import { TokensIcon } from '../../components/icons';
import {
  NOT_REPORTED,
  TOKENS_COPY,
  UNTITLED_SESSION,
  type TokensBreakdownWord,
} from '../../lib/copy';
import { formatCount, shortId } from '../../lib/format';
import { href, navigate } from '../../lib/router';
import { Figure, NEW_WORK_TYPES, Share, TOTAL_TYPES } from './figures';
import { Segmented } from '../../components/Segmented';
import { tokensHref, type TokensParams } from './tokens-params';

const B = TOKENS_COPY.breakdown;

/** One breakdown row: its name cell plus the usage and headline every group carries. */
interface Row {
  key: string;
  name: ReactNode;
  usage: UsageTotalsDto;
  headline: TokenHeadlineDto;
  cost?: ProjectTokensDto['bySession'][number]['latestEstimatedCost'];
}

function compactOrMissing(v: number | null): string {
  return v === null ? NOT_REPORTED : formatCount(v, 'compact');
}

/** Usage columns shared by every breakdown: direct usage, each figure with its partial state. */
const USAGE_COLUMNS: readonly Column<Row>[] = [
  {
    key: 'newWork',
    label: B.newWork,
    align: 'right',
    cell: (r) => (
      <span className="flex flex-col items-end" data-figure="newWork">
        <Figure value={r.headline.newWork} usage={r.usage} types={NEW_WORK_TYPES} />
        {/* Nothing to split when neither type was reported: the figure already says so. */}
        {r.headline.newWork === null ? null : (
          <span className="text-caption whitespace-nowrap text-dim tabular-nums">
            {B.inOut(
              compactOrMissing(r.usage.tokens.input),
              compactOrMissing(r.usage.tokens.output),
            )}
          </span>
        )}
      </span>
    ),
  },
  {
    // Read and write share one column (read on top, it is the large one) so the session table
    // keeps its cost column in view at 1024px. Each keeps its own "Partial" mark.
    key: 'cache',
    label: `${B.cacheRead} · ${B.cacheWrite}`,
    header: (
      <span className="inline-flex flex-col items-end">
        {B.cacheRead}
        <span className="font-normal normal-case">{B.cacheWrite}</span>
      </span>
    ),
    align: 'right',
    cell: (r) => (
      <span className="flex flex-col items-end gap-0.5">
        <span data-figure="cacheRead">
          <Figure
            value={r.usage.tokens.cacheRead}
            usage={r.usage}
            types={['cacheRead']}
            type="cacheRead"
          />
        </span>
        <span className="inline-flex items-center gap-1 text-caption text-dim">
          {B.writePrefix}
          <span data-figure="cacheCreation">
            <Figure
              value={r.usage.tokens.cacheCreation}
              usage={r.usage}
              types={['cacheCreation']}
              type="cacheCreation"
            />
          </span>
        </span>
      </span>
    ),
  },
  {
    key: 'total',
    label: `${B.total} · ${B.share}`,
    header: (
      <span className="inline-flex flex-col items-end">
        {B.total}
        <span className="font-normal normal-case">{B.share}</span>
      </span>
    ),
    align: 'right',
    // The share sits under the total (not in its own column) so the cost column fits at 1024px.
    cell: (r) => (
      <span className="flex flex-col items-end">
        <span data-figure="total">
          <Figure value={r.headline.totalProcessed} usage={r.usage} types={TOTAL_TYPES} />
        </span>
        {r.headline.totalProcessed === null ? null : (
          <span className="text-caption whitespace-nowrap text-dim" data-figure="share">
            <Share headline={r.headline} /> {B.fromCache}
          </span>
        )}
      </span>
    ),
  },
];

const COST_COLUMN: Column<Row> = {
  key: 'cost',
  label: `${B.cost} (${B.costProvenance})`,
  align: 'right',
  header: (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="inline-flex items-center gap-1">
        {B.cost}
        <InfoTip tip={B.costTip} label={B.cost} />
      </span>
      <ProvenanceBadge provenance="estimated" label={B.costProvenance} />
    </span>
  ),
  cell: (r) => (r.cost ? <EstimatedCost cost={r.cost} showLabel={false} /> : <NoCost />),
};

/** A session with no provider-reported running total: "Not reported", never $0. */
function NoCost() {
  return (
    <span className="text-unavailable" data-testid="cost" data-provenance="unavailable">
      {NOT_REPORTED}
    </span>
  );
}

function nameColumn(word: TokensBreakdownWord): Column<Row> {
  return { key: 'name', label: B.words[word], cell: (r) => r.name, className: 'max-w-64' };
}

function sessionRows(data: ProjectTokensDto): Row[] {
  return data.bySession.map((s) => ({
    key: s.sessionId,
    name: (
      <span className="flex min-w-0 flex-col">
        <a href={href.session(s.sessionId)} className="truncate font-medium">
          {s.title ?? UNTITLED_SESSION}
        </a>
        <span className="font-mono text-caption text-dim">{shortId(s.sessionId)}</span>
      </span>
    ),
    usage: s.usage,
    headline: s.headline,
    cost: s.latestEstimatedCost,
  }));
}

function ticketRows(data: ProjectTokensDto): Row[] {
  return data.byTicket.map((t) => ({
    key: t.ticketId,
    name: (
      <a href={href.ticket({ id: t.ticketId, projectId: data.projectId })} className="truncate">
        <span className="font-medium">{t.key}</span> {t.title}
      </a>
    ),
    usage: t.usage,
    headline: t.headline,
  }));
}

function roleRows(data: ProjectTokensDto): Row[] {
  return data.byRole.map((r) => {
    const copy = TOKENS_COPY.roles[r.role];
    return {
      key: r.role,
      name: (
        <span className="inline-flex items-center gap-1 font-medium">
          {copy.word}
          <InfoTip tip={copy.tip} label={copy.word} />
        </span>
      ),
      usage: r.usage,
      headline: r.headline,
    };
  });
}

function modelRows(data: ProjectTokensDto): Row[] {
  return data.byModel.map((m) => ({
    key: m.model,
    name:
      m.model === 'unknown' ? (
        <span className="text-dim">{B.unknownModel}</span>
      ) : (
        <span className="font-mono text-caption">{m.model}</span>
      ),
    usage: m.usage,
    headline: m.headline,
  }));
}

const ROWS: Record<TokensBreakdownWord, (d: ProjectTokensDto) => Row[]> = {
  session: sessionRows,
  ticket: ticketRows,
  role: roleRows,
  model: modelRows,
};

const NOTES: Partial<Record<TokensBreakdownWord, string>> = {
  ticket: B.ticketNote,
  role: B.roleNote,
};

const WORDS: readonly TokensBreakdownWord[] = ['session', 'ticket', 'role', 'model'];

/**
 * Where the tokens went: one table at a time, by session, ticket, agent role or model. Every row is
 * DIRECT usage (each session's own records), so rows never double-count helpers. The session
 * table's estimated cost is the provider's own running total per session, and has no total row.
 */
export function TokensBreakdown({
  data,
  params,
}: {
  data: ProjectTokensDto;
  params: TokensParams;
}) {
  const by = params.by;
  const columns = [nameColumn(by), ...USAGE_COLUMNS, ...(by === 'session' ? [COST_COLUMN] : [])];
  const note = NOTES[by];
  return (
    <Card
      title={B.title}
      description={B.description}
      padded={false}
      testId="tokens-breakdown"
      actions={<ProvenanceBadge provenance="derived" />}
    >
      <div className="px-5 pb-4">
        <Segmented
          label={B.by}
          value={by}
          onChange={(next) => navigate(tokensHref(data.projectId, { ...params, by: next }))}
          options={WORDS.map((w) => ({ value: w, label: B.words[w] }))}
        />
        {note ? <p className="mt-3 text-caption text-dim">{note}</p> : null}
      </div>
      {/* Seven columns fit at 1440; between 1024 and ~1280 the table scrolls inside the card. */}
      <div className="overflow-x-auto border-t border-line">
        <DataTable
          label={B.tableLabel(B.words[by])}
          columns={columns}
          rows={ROWS[by](data)}
          rowKey={(r) => r.key}
          rowAttributes={(r) => ({ 'data-row': r.key })}
          empty={<EmptyState compact icon={<TokensIcon size={18} />} title={B.empty[by]} />}
        />
      </div>
    </Card>
  );
}
