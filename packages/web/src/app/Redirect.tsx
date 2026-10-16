import { useEffect } from 'react';
import { ButtonLink } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorNotice } from '../components/ErrorNotice';
import {
  controlPaths,
  controlSchemas,
  paths,
  schemas,
  ticketPaths,
  ticketSchemas,
  type ApiError,
} from '../lib/api';
import { SHELL_COPY } from '../lib/copy';
import { useApiQuery } from '../lib/query';
import { href, replaceHash, type LegacyRoute } from '../lib/router';
import { readLastProject, validLastProject } from './last-project';
import { planRedirect, runTarget } from './redirects';

const C = SHELL_COPY.redirect;

/** Replaces the address (no history entry) once `hash` is known. */
export function RedirectTo({ hash }: { hash: string }) {
  useEffect(() => replaceHash(hash), [hash]);
  return null;
}

function Opening() {
  return (
    <p role="status" className="text-dim">
      {C.opening}
    </p>
  );
}

const isNotFound = (e: ApiError | null) => e?.kind === 'http' && e.status === 404;

function Missing({ copy }: { copy: { title: string; text: string } }) {
  return (
    <EmptyState
      title={copy.title}
      text={copy.text}
      action={
        <ButtonLink href={href.projects()} variant="primary">
          {SHELL_COPY.notFound.action}
        </ButtonLink>
      }
    />
  );
}

function TicketRedirect({ ticketId }: { ticketId: string }) {
  const detail = useApiQuery(ticketPaths.ticket(ticketId), ticketSchemas.detail);
  if (detail.data) return <RedirectTo hash={href.ticket(detail.data.ticket)} />;
  if (isNotFound(detail.error)) return <Missing copy={C.ticketMissing} />;
  if (detail.error) return <ErrorNotice error={detail.error} />;
  return <Opening />;
}

function RunRedirect({ runId }: { runId: string }) {
  const run = useApiQuery(controlPaths.run(runId), controlSchemas.run);
  if (run.data) return <RedirectTo hash={runTarget(run.data)} />;
  if (isNotFound(run.error)) return <Missing copy={C.runMissing} />;
  if (run.error) return <ErrorNotice error={run.error} />;
  return <Opening />;
}

/** Sends a pre-redesign address to its new home (src/app/redirects.ts has the rules). */
export function LegacyRedirect({ legacy }: { legacy: LegacyRoute }) {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  if (projects.data === undefined) {
    return projects.error ? <ErrorNotice error={projects.error} /> : <Opening />;
  }
  const plan = planRedirect(legacy, {
    lastProject: validLastProject(projects.data, readLastProject()),
    firstProject: projects.data[0]?.id ?? null,
  });
  if (plan.kind === 'ticket') return <TicketRedirect ticketId={plan.ticketId} />;
  if (plan.kind === 'run') return <RunRedirect runId={plan.runId} />;
  return <RedirectTo hash={plan.hash} />;
}
