import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { tokenText } from '../../components/TokenValue';
import { NOT_REPORTED, TOKENS_PAGE, tokenType } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { TOKEN_TYPE_COLOR, type TokenCategory } from '../../lib/tokens';
import type { ChartRow } from './chart-rows';

/** The two token types one chart compares. The second is dashed, so color is not the only cue. */
export type SeriesPair = readonly [TokenCategory, TokenCategory];

export const INPUT_OUTPUT: SeriesPair = ['input', 'output'];
export const CACHE: SeriesPair = ['cacheCreation', 'cacheRead'];

const DASH: readonly string[] = ['', '6 4'];
const dash = (i: number): string => DASH[i] ?? '';

const dayLong = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const dayShort = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});
const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** "Oct 9" for axis ticks; the API's days are UTC, so they are formatted in UTC. */
export function formatDayShort(day: string): string {
  return dayShort.format(asDate(day));
}
/** "Fri, Oct 9, 2026" for tooltips and tables. */
export function formatDayLong(day: string): string {
  return dayLong.format(asDate(day));
}

function Swatch({ type, index }: { type: TokenCategory; index: number }) {
  return (
    <svg width="22" height="10" aria-hidden="true" className="shrink-0">
      <line
        x1="1"
        y1="5"
        x2="21"
        y2="5"
        stroke={TOKEN_TYPE_COLOR[type].css}
        strokeWidth="2"
        strokeDasharray={dash(index)}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Exact values with their units for one day; a type the day did not report says so. */
function DayTooltip({ row, series }: { row: ChartRow | undefined; series: SeriesPair }) {
  if (!row) return null;
  return (
    <div className="rounded-control border border-line bg-panel px-3 py-2 text-caption text-ink shadow-pop">
      <div className="mb-1 font-medium">{formatDayLong(row.day)}</div>
      {series.map((key, i) => {
        const v = row[key];
        const t = tokenType(key);
        return (
          <div key={key} className="flex items-center gap-2 tabular-nums">
            <Swatch type={key} index={i} />
            {v === null ? (
              <span>
                {t.label}: <span className="text-unavailable">{NOT_REPORTED}</span>
              </span>
            ) : (
              <span>{tokenText(v, key)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Tokens per UTC day as two plain lines, deliberately NOT stacked and with `connectNulls` off: a
 * day that did not report a type (`null`) is a gap, never a zero. Cache types are priced
 * differently from input/output and are often far larger, so they get their own chart and scale.
 */
export function UsageChart({
  title,
  rows,
  series,
}: {
  title: string;
  rows: readonly ChartRow[];
  series: SeriesPair;
}) {
  return (
    <figure className="m-0 min-w-0" data-testid={`chart-${series[0]}`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium">{title}</span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-dim">
          {series.map((key, i) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <Swatch type={key} index={i} />
              {tokenType(key).label}
            </span>
          ))}
        </span>
      </figcaption>
      <div className="mt-3 text-caption text-dim" aria-hidden="true">
        {TOKENS_PAGE.charts.tokensAxis}
      </div>
      <div className="h-56 w-full" role="img" aria-label={title}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 224 }}
        >
          <LineChart data={[...rows]} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={formatDayShort}
              tick={{ fontSize: 12, fill: 'var(--color-dim)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-line-strong)' }}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 12, fill: 'var(--color-dim)' }}
              tickFormatter={(v: number) => formatCount(v, 'compact')}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              cursor={{ stroke: 'var(--color-line-strong)' }}
              isAnimationActive={false}
              content={(props) => (
                <DayTooltip
                  row={
                    props.active ? (props.payload?.[0]?.payload as ChartRow | undefined) : undefined
                  }
                  series={series}
                />
              )}
            />
            {series.map((key, i) => (
              <Line
                key={key}
                type="linear"
                dataKey={key}
                name={tokenType(key).label}
                stroke={TOKEN_TYPE_COLOR[key].css}
                strokeWidth={2}
                strokeDasharray={dash(i)}
                dot={{
                  r: rows.length > 45 ? 2.5 : 4,
                  strokeWidth: 1.5,
                  stroke: 'var(--color-panel)',
                  fill: TOKEN_TYPE_COLOR[key].css,
                }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--color-panel)' }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 text-right text-caption text-dim" aria-hidden="true">
        {TOKENS_PAGE.charts.dayAxis}
      </div>
    </figure>
  );
}
