import { useCallback, useMemo } from 'react';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import {
  boardPaths,
  boardSchemas,
  createHarnessTicket,
  harnessHistoryPaths,
  harnessHistorySchemas,
  isBoardPath,
  isProjectSetupPath,
  projectSetupPaths,
  projectSetupSchemas,
} from '../../lib/api';
import { HARNESS_PAGE_COPY } from '../../lib/copy';
import { useApiQuery, useQueryStore } from '../../lib/query';
import { useSetupAction } from '../project-setup/actions';
import { ChecksCard } from './ChecksCard';
import { canRunChecks, offerBuild, pickHarnessTicket } from './logic';
import { useMainCheckRuns } from './main-check-runs';
import { RunsCard } from './RunsCard';
import { StatusCard } from './StatusCard';
import { UsageCard } from './UsageCard';

const C = HARNESS_PAGE_COPY;

/**
 * `#/p/:projectId/harness` (docs/redesign/README.md §4.4): does the project have a harness, and
 * does it pass? The status from `GET /projects/:id/harness` (read fresh from the project folder),
 * the checks it lists, "Run checks now" on the main branch with every stored run, the
 * "Build the harness" ticket, and where the checks are used.
 */
export function HarnessPage({ projectId, now }: { projectId: string; now?: () => Date }) {
  const store = useQueryStore();
  const harnessPath = projectSetupPaths.harness(projectId);
  const harness = useApiQuery(harnessPath, projectSetupSchemas.harness);
  const tickets = useApiQuery(boardPaths.tickets(projectId), boardSchemas.tickets);
  const history = useApiQuery(
    harnessHistoryPaths.history(projectId),
    harnessHistorySchemas.history,
  );
  const runs = useMainCheckRuns(projectId);

  const invalidate = useMemo(() => {
    const setup = isProjectSetupPath(projectId);
    return (key: string) => setup(key) || isBoardPath(key);
  }, [projectId]);
  const build = useSetupAction(createHarnessTicket, invalidate);
  const refresh = useCallback(
    () => store.invalidate((key) => key === harnessPath),
    [store, harnessPath],
  );

  const runnable = harness.data !== undefined && canRunChecks(harness.data.state);
  const ticket = pickHarnessTicket(tickets.data, build.result);
  const runButton = runnable ? (
    <Button variant="primary" disabled={runs.running} onClick={() => void runs.start()}>
      {runs.running ? C.runs.running : C.runs.run}
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader title={C.title} tip={C.tip} description={C.description} actions={runButton} />
      <QueryView query={harness} loading={C.loading}>
        {(h) => {
          const canRun = canRunChecks(h.state);
          // An invalid manifest usually lists nothing usable: no empty Checks card for it.
          const hasChecks = canRun || h.checks.length > 0;
          return (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <StatusCard
                className="xl:col-span-3"
                harness={h}
                ticket={ticket}
                created={build.result !== null && ticket?.id === build.result.id}
                showBuild={offerBuild(h.state, ticket)}
                build={{
                  pending: build.pending,
                  error: build.error,
                  run: () => void build.run(projectId),
                }}
                refreshing={harness.fetching}
                onRefresh={refresh}
              />
              {hasChecks ? <ChecksCard className="xl:col-span-2" harness={h} /> : null}
              <UsageCard
                projectId={projectId}
                className={hasChecks ? 'xl:col-span-1' : 'xl:col-span-3'}
              />
              {canRun || runs.attempts.length > 0 || (history.data?.length ?? 0) > 0 ? (
                <RunsCard
                  className="xl:col-span-3"
                  attempts={runs.attempts}
                  history={history}
                  runnable={canRun}
                  {...(now === undefined ? {} : { now })}
                />
              ) : null}
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}
