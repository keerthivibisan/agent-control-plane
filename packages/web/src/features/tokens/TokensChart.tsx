import type { TokenCounts } from '@acp/core';
import { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { tokenText } from '../../components/TokenValue';
import { NOT_REPORTED, TOKENS_COPY, tokenType } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { TOKEN_TYPE_COLOR, type TokenCategory } from '../../lib/tokens';

export interface DayRow extends TokenCounts {
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
}

/** The two token types a chart compares. The second is dashed, so color is never the only cue. */
export type SeriesPair = readonly [TokenCategory, TokenCategory];
export const NEW_WORK: SeriesPair = ['input', 'output'];
export const CACHE: SeriesPair = ['cacheCreation', 'cacheRead'];

const DASH = ['', '6 4'] as const;
const dash = (i: number): string => DASH[i === 0 ? 0 : 1];

const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const dayShort = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});
const dayLong = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
/** "Oct 9" (UTC, as the API's days are). */
export const formatDayShort = (day: string): string => dayShort.format(asDate(day));
/** "Fri, Oct 9, 2026". */
export const formatDayLong = (day: string): string => dayLong.format(asDate(day));

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

function DayTooltip({ row, series }: { row: DayRow | undefined; series: SeriesPair }) {
  if (!row) return null;
  return (
    <div className="min-w-44 rounded-control border border-line bg-panel-raised px-3 py-2 text-caption text-ink shadow-pop">
      <div className="mb-1.5 font-medium">{formatDayLong(row.day)}</div>
      {series.map((key, i) => {
        const v = row[key];
        return (
          <div key={key} className="flex items-center gap-2 tabular-nums">
            <Swatch type={key} index={i} />
            {v === null ? (
              <span>
                {tokenType(key).label}: <span className="text-unavailable">{NOT_REPORTED}</span>
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
 * Tokens per UTC day as two plain lines, each over a faint fill that fades to the axis: not
 * stacked, and `connectNulls` off, so a day that did not report a type is a gap, never a zero. New
 * work and cache differ by about 1000×, so each pair gets its own chart and its own scale (never a
 * second y-axis).
 */
export function TokensChart({
  title,
  rows,
  series,
}: {
  title: string;
  rows: readonly DayRow[];
  series: SeriesPair;
}) {
  // Gradient ids must be unique per chart and safe inside `url(#…)`.
  const fillId = `fill${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // Dots help to read a few days; on a long range they would crowd the line, so only on hover.
  const dots = rows.length <= 31;
  return (
    <figure className="m-0 min-w-0" data-testid={`tokens-chart-${series[0]}`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium text-ink">{title}</span>
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
        {TOKENS_COPY.charts.tokensAxis}
      </div>
      <div className="h-56 w-full" role="img" aria-label={title}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 560, height: 224 }}
        >
          <AreaChart data={[...rows]} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              {series.map((key) => (
                <linearGradient key={key} id={`${fillId}-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TOKEN_TYPE_COLOR[key].css} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={TOKEN_TYPE_COLOR[key].css} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={formatDayShort}
              tick={{ fontSize: 12, fill: 'var(--color-dim)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-line)' }}
              tickMargin={6}
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
              cursor={{ stroke: 'var(--color-line-strong)', strokeDasharray: '3 3' }}
              isAnimationActive={false}
              content={(props) => (
                <DayTooltip
                  row={
                    props.active ? (props.payload?.[0]?.payload as DayRow | undefined) : undefined
                  }
                  series={series}
                />
              )}
            />
            {series.map((key, i) => (
              <Area
                key={key}
                type="linear"
                dataKey={key}
                name={tokenType(key).label}
                stroke={TOKEN_TYPE_COLOR[key].css}
                strokeWidth={2}
                strokeDasharray={dash(i)}
                fill={`url(#${fillId}-${key})`}
                dot={
                  dots
                    ? {
                        r: 3,
                        strokeWidth: 1.5,
                        stroke: 'var(--color-panel)',
                        fill: TOKEN_TYPE_COLOR[key].css,
                      }
                    : false
                }
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--color-panel)' }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 text-right text-caption text-dim" aria-hidden="true">
        {TOKENS_COPY.charts.dayAxis}
      </div>
    </figure>
  );
}
