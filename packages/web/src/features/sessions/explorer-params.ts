import { ProviderIdSchema, SessionStatusSchema } from '@acp/core';
import type { SessionFilters } from '../../lib/api';
import { href } from '../../lib/router';

/** `relationships` is the family tree; `graph` the same family as a diagram. */
export type RelateView = 'relationships' | 'graph' | 'timeline';

/** Sessions-page state lives in the hash (`#/sessions?status=stale&root=…`) so views can be linked. */
export interface ExplorerParams {
  projectId?: string | undefined;
  provider?: string | undefined;
  status?: string | undefined;
  model?: string | undefined;
  q?: string | undefined;
  /** Session whose relationships are drawn. */
  root?: string | undefined;
  view?: RelateView | undefined;
}

const nonEmpty = (v: string | null) => (v && v.trim().length > 0 ? v.trim() : undefined);

function readView(v: string | null): RelateView | undefined {
  return v === 'timeline' || v === 'graph' || v === 'relationships' ? v : undefined;
}

export function readExplorerParams(params: URLSearchParams): ExplorerParams {
  const provider = ProviderIdSchema.safeParse(params.get('provider'));
  const status = SessionStatusSchema.safeParse(params.get('status'));
  return {
    projectId: nonEmpty(params.get('projectId')),
    provider: provider.success ? provider.data : undefined,
    status: status.success ? status.data : undefined,
    model: nonEmpty(params.get('model')),
    q: nonEmpty(params.get('q')),
    root: nonEmpty(params.get('root')),
    view: readView(params.get('view')),
  };
}

export function explorerHref(p: ExplorerParams): string {
  return href.sessions({ ...p });
}

/** Link to a session's relationships on the Sessions page. */
export function relationshipsHref(sessionId: string): string {
  return explorerHref({ root: sessionId, view: 'relationships' });
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

export function hasFilters(p: ExplorerParams): boolean {
  return Object.values(toSessionFilters(p)).some((v) => v !== undefined);
}
