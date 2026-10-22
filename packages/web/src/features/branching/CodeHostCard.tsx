import { useCallback } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, CheckIcon } from '../../components/icons';
import { Pill } from '../../components/Pill';
import { LoadingBlock } from '../../components/Skeleton';
import { codeHostPaths, codeHostSchemas } from '../../lib/api';
import { CODE_HOST_COPY } from '../../lib/copy';
import { useApiQuery, useQueryStore } from '../../lib/query';
import { codeHostReadiness } from './code-host';

const C = CODE_HOST_COPY;

/**
 * The project's code host status (`GET /api/projects/:id/code-host`), read when a screen that
 * needs it is shown and on "Check again", never on a timer (ADR-0025 §2). `recheck` asks again.
 */
export function useCodeHost(projectId: string | null) {
  const path = projectId === null ? null : codeHostPaths.status(projectId);
  const q = useApiQuery(path, codeHostSchemas.status);
  const store = useQueryStore();
  const recheck = useCallback(() => {
    if (path !== null) store.invalidate((key) => key === path);
  }, [store, path]);
  return { ...q, recheck };
}

/**
 * Settings' GitHub card: "Connected to GitHub: owner/repo", or what to fix in plain words (no
 * GitHub remote, no GitHub CLI, not signed in), with Check again.
 */
export function CodeHostCard({ projectId }: { projectId: string }) {
  const host = useCodeHost(projectId);
  const status = host.data;
  const readiness = status === undefined ? null : codeHostReadiness(status);
  return (
    <Card
      title={C.title}
      tip={C.tip}
      description={C.description}
      testId="settings-code-host"
      actions={
        readiness === null ? null : (
          <span data-testid="code-host-state" data-state={readiness.kind}>
            <Pill tone={readiness.kind === 'ready' ? 'success' : 'warning'}>
              {readiness.kind === 'ready' ? C.word.connected : C.word.notConnected}
            </Pill>
          </span>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {status === undefined ? (
          host.error !== null ? (
            <div className="flex flex-col gap-1.5" data-testid="code-host-error">
              <p role="alert" className="flex items-start gap-2 text-danger">
                <AlertIcon size={16} className="mt-0.5 shrink-0" />
                {C.loadFailed}
              </p>
              <Details>
                <ErrorNotice error={host.error} />
              </Details>
            </div>
          ) : (
            <LoadingBlock label={C.checking} />
          )
        ) : readiness?.kind === 'ready' ? (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-2" data-testid="code-host-message">
              <CheckIcon size={16} className="shrink-0 text-success" />
              <span className="min-w-0 break-words">{C.connected(readiness.repo)}</span>
            </p>
            {status.defaultBranch !== null ? (
              <p className="text-caption text-dim">
                {C.defaultBranch}:{' '}
                <span className="font-mono text-ink">{status.defaultBranch}</span>
              </p>
            ) : null}
          </div>
        ) : readiness !== null ? (
          <p
            className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5"
            data-testid="code-host-message"
            data-problem={readiness.problem}
          >
            <AlertIcon size={16} className="mt-0.5 shrink-0 text-warning" />
            <span className="min-w-0">{C.problems[readiness.problem]}</span>
          </p>
        ) : null}
        <div>
          <Button size="sm" onClick={host.recheck} disabled={host.fetching}>
            {host.fetching && status !== undefined ? C.rechecking : C.recheck}
          </Button>
        </div>
      </div>
    </Card>
  );
}
