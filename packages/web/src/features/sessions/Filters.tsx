import { SessionStatusSchema } from '@acp/core';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, ButtonLink } from '../../components/Button';
import { InfoTip } from '../../components/InfoTip';
import { paths, schemas } from '../../lib/api';
import { SESSIONS_COPY, STATUS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { navigate } from '../../lib/router';
import { explorerHref, hasFilters, type ExplorerParams } from './explorer-params';

const COPY = SESSIONS_COPY.filters;

export const fieldClass =
  'h-9 rounded-control border border-line bg-panel px-2.5 text-ink hover:border-line-strong';

function Field({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1 text-caption font-medium text-dim">
        {label}
        {tip ? <InfoTip tip={tip} label={label} /> : null}
      </span>
      {children}
    </label>
  );
}

/**
 * The Sessions filters, in one row: Project, Status (in plain words), Model, and a search box.
 * The provider filter appears only when more than one provider is connected. Selects apply at
 * once; the search applies on Enter. Remount (key) when the URL changes so the box follows it.
 */
export function Filters({ params }: { params: ExplorerParams }) {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const capabilities = useApiQuery(paths.capabilities(), schemas.capabilities);
  // Models observed in usage records, from the usage summary grouped by model.
  const models = useApiQuery(paths.usageSummary({ groupBy: 'model' }), schemas.usageSummary);
  const [q, setQ] = useState(params.q ?? '');
  const providers = capabilities.data?.providers.map((p) => p.provider) ?? [];

  const go = (change: Partial<ExplorerParams>) => navigate(explorerHref({ ...params, ...change }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go({ q: q.trim() || undefined });
  };
  const modelIds = models.data?.groups.map((g) => g.key).filter((k) => k !== 'unknown') ?? [];
  // A model in the URL that the summary doesn't list still shows as selected, not as "Any model".
  if (params.model && !modelIds.includes(params.model)) modelIds.unshift(params.model);

  return (
    <form
      onSubmit={onSubmit}
      aria-label={COPY.label}
      className="flex flex-wrap items-end gap-x-4 gap-y-3"
    >
      <Field label={COPY.project}>
        <select
          className={`${fieldClass} w-48`}
          value={params.projectId ?? ''}
          onChange={(e) => go({ projectId: e.target.value || undefined })}
        >
          <option value="">{COPY.allProjects}</option>
          {projects.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={COPY.status}>
        <select
          className={`${fieldClass} w-36`}
          value={params.status ?? ''}
          onChange={(e) => go({ status: e.target.value || undefined })}
        >
          <option value="">{COPY.anyStatus}</option>
          {SessionStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {STATUS_COPY[s].word}
            </option>
          ))}
        </select>
      </Field>
      <Field label={COPY.model}>
        <select
          className={`${fieldClass} w-52`}
          value={params.model ?? ''}
          onChange={(e) => go({ model: e.target.value || undefined })}
        >
          <option value="">{COPY.anyModel}</option>
          {modelIds.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      {providers.length > 1 ? (
        <Field label={COPY.provider}>
          <select
            className={`${fieldClass} w-40`}
            value={params.provider ?? ''}
            onChange={(e) => go({ provider: e.target.value || undefined })}
          >
            <option value="">{COPY.anyProvider}</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="flex min-w-60 flex-1 items-end gap-2">
        <div className="flex-1">
          <Field label={COPY.search} tip={COPY.searchTip}>
            <input
              type="search"
              className={`${fieldClass} w-full`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={COPY.searchPlaceholder}
            />
          </Field>
        </div>
        {/* Enter submits; the button is there for pointer users and to make that discoverable. */}
        <Button type="submit" className="h-9">
          {COPY.find}
        </Button>
      </div>
      {hasFilters(params) ? (
        <ButtonLink
          href={explorerHref({ root: params.root, view: params.view })}
          variant="quiet"
          className="h-9"
        >
          {COPY.clear}
        </ButtonLink>
      ) : null}
    </form>
  );
}
