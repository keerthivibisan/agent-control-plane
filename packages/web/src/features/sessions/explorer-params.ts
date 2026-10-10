import { ProviderIdSchema, SessionStatusSchema } from '@acp/core';
import type { SessionFilters } from '../../lib/api';
import { href } from '../../lib/router';

/** Explorer state lives in the hash (`#/sessions?status=stale&root=…`) so views can be linked. */
export interface ExplorerParams {
  projectId?: string | undefined;
  provider?: string | undefined;
  status?: string | undefined;
  model?: string | undefined;
  q?: string | undefined;
  /** Session whose tree is shown in the graph. */
  root?: string | undefined;
  view?: 'graph' | 'timeline' | undefined;
}

const nonEmpty = (v: string | null) => (v && v.trim().length > 0 ? v.trim() : undefined);

export function readExplorerParams(params: URLSearchParams): ExplorerParams {
  const provider = ProviderIdSchema.safeParse(params.get('provider'));
  const status = SessionStatusSchema.safeParse(params.get('status'));
  const view = params.get('view');
  return {
    projectId: nonEmpty(params.get('projectId')),
    provider: provider.success ? provider.data : undefined,
    status: status.success ? status.data : undefined,
    model: nonEmpty(params.get('model')),
    q: nonEmpty(params.get('q')),
    root: nonEmpty(params.get('root')),
    view: view === 'timeline' ? 'timeline' : view === 'graph' ? 'graph' : undefined,
  };
}

export function explorerHref(p: ExplorerParams): string {
  return href.sessions({ ...p });
}

export function toSessionFilters(p: ExplorerParams): SessionFilters {
  return {
    projectId: p.projectId,
    provider: p.provider,
    status: p.status,
    model: p.model,
    q: p.q,
  };
}
