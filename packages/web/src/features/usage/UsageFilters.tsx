import { useId } from 'react';
import { Card } from '../../components/Card';
import { paths, schemas } from '../../lib/api';
import { TOKENS_PAGE, type DatePreset, type UsageGroupWord } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { navigate } from '../../lib/router';
import { presetRange, usageHref, type UsageParams } from './usage-params';

const field =
  'h-9 rounded-control border border-line bg-panel px-2.5 text-ink hover:border-line-strong';

/** A row of toggle buttons for a small set of choices; the chosen one is `aria-pressed`. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-caption font-medium text-dim">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={id}
        className="inline-flex flex-wrap gap-0.5 rounded-control border border-line bg-sunken p-0.5"
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={`rounded-[0.375rem] px-3 py-1 transition-colors ${
                on ? 'bg-panel font-medium text-ink shadow-card' : 'text-dim hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const PRESETS: readonly DatePreset[] = ['7d', '30d', 'all', 'custom'];
const GROUPS: readonly UsageGroupWord[] = ['project', 'session', 'model', 'day'];

/** Date range, project and grouping. Every change is a new hash, so the view is linkable. */
export function UsageFilters({ params, now }: { params: UsageParams; now: () => Date }) {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const { filters, groupWords } = TOKENS_PAGE;
  const go = (change: Partial<UsageParams>) => navigate(usageHref({ ...params, ...change }));

  const choosePreset = (preset: DatePreset) => {
    if (preset === 'custom') {
      // Start the custom range from what is on screen, so switching changes nothing yet.
      const seed =
        params.preset === '7d' || params.preset === '30d' ? presetRange(params.preset, now()) : {};
      go({ preset, from: undefined, to: undefined, ...seed });
    } else go({ preset, from: undefined, to: undefined });
  };

  const filtered = params.preset !== 'all' || params.projectId !== undefined;

  return (
    <Card padded>
      <form
        aria-label={filters.label}
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-wrap items-end gap-x-6 gap-y-4"
      >
        <Segmented
          label={filters.dates}
          value={params.preset}
          onChange={choosePreset}
          options={PRESETS.map((p) => ({ value: p, label: filters.presets[p] }))}
        />
        {params.preset === 'custom' ? (
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1.5 text-caption font-medium text-dim">
              {filters.from}
              <input
                type="date"
                className={field}
                value={params.from ?? ''}
                max={params.to}
                onChange={(e) => go({ from: e.target.value || undefined })}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-caption font-medium text-dim">
              {filters.to}
              <input
                type="date"
                className={field}
                value={params.to ?? ''}
                min={params.from}
                onChange={(e) => go({ to: e.target.value || undefined })}
              />
            </label>
          </div>
        ) : null}
        <label className="flex flex-col gap-1.5 text-caption font-medium text-dim">
          {filters.project}
          <select
            className={`${field} min-w-44`}
            value={params.projectId ?? ''}
            onChange={(e) => go({ projectId: e.target.value || undefined })}
          >
            <option value="">{filters.allProjects}</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Segmented
          label={filters.groupBy}
          value={params.groupBy}
          onChange={(groupBy) => go({ groupBy })}
          options={GROUPS.map((g) => ({ value: g, label: groupWords[g] }))}
        />
        {filtered ? (
          <a className="pb-1.5" href={usageHref({ groupBy: params.groupBy })}>
            {filters.clear}
          </a>
        ) : null}
      </form>
      {params.preset !== 'all' ? (
        <p className="mt-3 text-caption text-dim">{filters.utcNote}</p>
      ) : null}
    </Card>
  );
}
