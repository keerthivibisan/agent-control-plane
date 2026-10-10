import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TokenCategory } from '../../lib/tokens';
import { formatCount } from '../../lib/format';
import type { ChartRow } from './chart-rows';

export interface SeriesSpec {
  key: TokenCategory;
  label: string;
  color: string;
}

/** Fixed hues readable on both themes; each series also has its own marker shape via the legend name. */
export const INPUT_OUTPUT: readonly SeriesSpec[] = [
  { key: 'input', label: 'Input', color: '#3b82f6' },
  { key: 'output', label: 'Output', color: '#f59e0b' },
];
export const CACHE: readonly SeriesSpec[] = [
  { key: 'cacheCreation', label: 'Cache creation', color: '#a855f7' },
  { key: 'cacheRead', label: 'Cache read', color: '#14b8a6' },
];

const tooltipValue = (v: unknown): string =>
  typeof v === 'number' ? formatCount(v) : 'unavailable';

/**
 * Tokens per UTC day as plain lines, deliberately NOT stacked and with `connectNulls` off: an
 * unavailable day (`null`) is a gap, never a zero. Cache categories are priced differently from
 * input/output and are orders of magnitude larger, so they get their own chart and scale.
 */
export function UsageChart({
  title,
  rows,
  series,
}: {
  title: string;
  rows: readonly ChartRow[];
  series: readonly SeriesSpec[];
}) {
  return (
    <figure className="min-w-0" data-testid={`chart-${series[0]?.key ?? 'empty'}`}>
      <figcaption className="mb-1 text-[11px] font-medium text-dim">{title}</figcaption>
      <div className="h-60 w-full" role="img" aria-label={title}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 240 }}
        >
          <LineChart data={[...rows]} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--color-dim)' }} />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--color-dim)' }}
              tickFormatter={(v: number) => formatCount(v, 'compact')}
              width={56}
            />
            <Tooltip
              formatter={tooltipValue}
              contentStyle={{
                background: 'var(--color-panel)',
                border: '1px solid var(--color-line)',
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
