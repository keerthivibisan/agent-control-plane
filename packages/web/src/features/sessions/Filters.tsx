import { ProviderIdSchema, SessionStatusSchema } from '@acp/core';
import { useState, type FormEvent } from 'react';
import { STATUS_LABELS } from '../../components/StatusPill';
import { paths, schemas } from '../../lib/api';
import { useApiQuery } from '../../lib/query';
import { navigate } from '../../lib/router';
import { explorerHref, type ExplorerParams } from './explorer-params';

const field = 'rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-ink';

/**
 * Explorer filters. Selects apply immediately; the model and session-id text fields apply on Enter
 * or "apply". Remount (key) when the URL changes so the text fields follow it.
 */
export function Filters({ params }: { params: ExplorerParams }) {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  // Distinct model ids come from the usage summary grouped by model (observed in usage records).
  const models = useApiQuery(paths.usageSummary({ groupBy: 'model' }), schemas.usageSummary);
  const [model, setModel] = useState(params.model ?? '');
  const [q, setQ] = useState(params.q ?? '');

  const go = (change: Partial<ExplorerParams>) => navigate(explorerHref({ ...params, ...change }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go({ model: model.trim() || undefined, q: q.trim() || undefined });
  };

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Session filters"
      className="flex flex-wrap items-end gap-2 rounded border border-line bg-panel px-3 py-2"
    >
      <label className="flex flex-col gap-0.5 text-[11px] text-dim">
        Project
        <select
          className={field}
          value={params.projectId ?? ''}
          onChange={(e) => go({ projectId: e.target.value || undefined })}
        >
          <option value="">all projects</option>
          {projects.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-dim">
        Provider
        <select
          className={field}
          value={params.provider ?? ''}
          onChange={(e) => go({ provider: e.target.value || undefined })}
        >
          <option value="">all providers</option>
          {ProviderIdSchema.options.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-dim">
        Status
        <select
          className={field}
          value={params.status ?? ''}
          onChange={(e) => go({ status: e.target.value || undefined })}
        >
          <option value="">all statuses</option>
          {SessionStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-dim">
        Model
        <input
          className={`${field} w-44 font-mono`}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          list="explorer-models"
          placeholder="any model"
        />
        <datalist id="explorer-models">
          {models.data?.groups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-dim">
        Session id
        <input
          className={`${field} w-56 font-mono`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search by session id"
          type="search"
        />
      </label>
      <button
        type="submit"
        className="rounded border border-line px-2 py-0.5 text-xs hover:bg-sunken"
      >
        apply
      </button>
      <a href={explorerHref({})} className="py-0.5 text-xs">
        reset
      </a>
    </form>
  );
}
