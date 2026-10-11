import type { UsageSummaryDto, UsageTotalsDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { TokensIcon } from '../../components/icons';
import { QueryView } from '../../components/QueryView';
import { Tooltip } from '../../components/Tooltip';
import { TokenValue } from '../../components/TokenValue';
import { paths, schemas } from '../../lib/api';
import { partialNote, TOKEN_TYPES, TOKENS_PAGE, type TokenTypeCopy } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { TOKEN_TYPE_COLOR } from '../../lib/tokens';
import { formatDayLong } from './UsageChart';
import { toUsageQuery, type UsageParams } from './usage-params';

type Group = UsageSummaryDto['groups'][number];

/** Keys the server uses for "no project / session / model / date" groups. */
const NO_KEY = new Set(['unknown', 'unassigned']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Day groups newest first; the others by output tokens, most first (a group that did not report
 * output goes last, it is not treated as 0). Ties keep the API order.
 */
export function sortGroups(groups: readonly Group[], groupBy: UsageParams['groupBy']): Group[] {
  const out = [...groups];
  if (groupBy === 'day') {
    return out.sort((a, b) => {
      const ad = DAY.test(a.key);
      const bd = DAY.test(b.key);
      if (ad !== bd) return ad ? -1 : 1;
      return b.key.localeCompare(a.key);
    });
  }
  return out.sort((a, b) => {
    const ao = a.usage.tokens.output;
    const bo = b.usage.tokens.output;
    if (ao === bo) return 0;
    if (ao === null) return 1;
    if (bo === null) return -1;
    return bo - ao;
  });
}

function GroupName({ group, groupBy }: { group: Group; groupBy: UsageParams['groupBy'] }) {
  if (NO_KEY.has(group.key)) return <span className="text-dim italic">{group.label}</span>;
  if (groupBy === 'day' && DAY.test(group.key))
    return <span className="whitespace-nowrap">{formatDayLong(group.key)}</span>;
  const link =
    groupBy === 'session'
      ? href.session(group.key)
      : groupBy === 'project'
        ? href.project(group.key)
        : null;
  const text = <span className="block max-w-56 truncate xl:max-w-80">{group.label}</span>;
  if (link === null) return <span className="whitespace-nowrap">{group.label}</span>;
  return (
    <Tooltip content={group.label} focusable={false}>
      <a href={link} className="font-medium">
        {text}
      </a>
    </Tooltip>
  );
}

function TokenCell({ usage, type }: { usage: UsageTotalsDto; type: TokenTypeCopy }) {
  const value = usage.tokens[type.key];
  const missing = usage.recordsWithUnavailable[type.key];
  return (
    <span className="inline-flex items-baseline gap-1.5" data-category={type.key}>
      <TokenValue value={value} type={type.key} compact showUnit={false} />
      {value !== null && missing > 0 ? (
        <Tooltip content={partialNote(missing, usage.recordCount)}>
          <span
            className="text-caption text-dim underline decoration-dotted"
            data-partial={type.key}
          >
            {TOKENS_PAGE.breakdown.partial}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

function columns(groupBy: UsageParams['groupBy']): Column<Group>[] {
  return [
    {
      key: 'name',
      label: TOKENS_PAGE.groupWords[groupBy],
      cell: (g) => <GroupName group={g} groupBy={groupBy} />,
    },
    ...TOKEN_TYPES.map((t): Column<Group> => ({
      key: t.key,
      label: t.label,
      align: 'right',
      header: (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`inline-block size-2 rounded-sm ${TOKEN_TYPE_COLOR[t.key].bg}`}
          />
          {t.label}
        </span>
      ),
      cell: (g) => <TokenCell usage={g.usage} type={t} />,
    })),
  ];
}

/** The table under the charts: tokens per project / session / model / day, never totalled across types. */
export function UsageBreakdown({ params }: { params: UsageParams }) {
  const query = useApiQuery(
    paths.usageSummary(toUsageQuery(params, params.groupBy)),
    schemas.usageSummary,
  );
  const { breakdown } = TOKENS_PAGE;
  return (
    <Card
      title={breakdown.title(params.groupBy)}
      description={
        <span data-testid="direct-note">
          {breakdown.countedOnce}{' '}
          {params.groupBy === 'day' ? breakdown.sortedByDay : breakdown.sortedByOutput}
        </span>
      }
      padded={false}
      testId="usage-breakdown"
    >
      <div className="overflow-x-auto px-1 pb-2">
        <QueryView query={query}>
          {(s) => (
            <DataTable
              label={breakdown.title(params.groupBy)}
              columns={columns(params.groupBy)}
              rows={sortGroups(s.groups, params.groupBy)}
              rowKey={(g) => g.key}
              rowAttributes={(g) => ({ 'data-group': g.key })}
              empty={
                <EmptyState
                  compact
                  icon={<TokensIcon size={18} />}
                  title={TOKENS_PAGE.emptyRange.title}
                  text={TOKENS_PAGE.emptyRange.text}
                />
              }
            />
          )}
        </QueryView>
      </div>
    </Card>
  );
}
