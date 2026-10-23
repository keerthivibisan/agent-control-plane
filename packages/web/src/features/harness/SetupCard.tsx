import type { HarnessStatusDto, ProjectAgentSetupDto, SetupRunDto } from '@acp/core/api';
import { useId, useMemo } from 'react';
import { Badge } from '../../components/Pill';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { InfoTip } from '../../components/InfoTip';
import { isProjectSetupPath, isWorkflowGraphPath, updateProjectSetup } from '../../lib/api';
import { formatSeconds, HARNESS_BLOCKS_COPY } from '../../lib/copy';
import { ActionError } from '../control/bits';
import { useSetupAction } from '../project-setup/actions';
import { networkRequest, setupSteps } from './logic';
import { SetupRunList } from './SetupRuns';

const S = HARNESS_BLOCKS_COPY.harness.setup;
const N = HARNESS_BLOCKS_COPY.harness.network;
const L = HARNESS_BLOCKS_COPY.harness.latestSetup;

type Step = NonNullable<HarnessStatusDto['setup']>[number];

const code =
  'rounded-[0.3125rem] border border-line bg-sunken px-1.5 py-0.5 font-mono text-caption break-all';

const COLUMNS: readonly Column<Step>[] = [
  {
    key: 'name',
    label: S.step,
    cell: (s) => (
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{s.name}</span>
        {s.network === true ? (
          <Badge tone="warning" title={S.networkTip} testId="uses-network">
            {S.network}
          </Badge>
        ) : null}
      </span>
    ),
  },
  {
    key: 'command',
    label: S.command,
    // The argv as the server runs it, word by word; never a shell line (ADR-0017 §3).
    cell: (s) => <code className={code}>{s.argv.join(' ')}</code>,
    className: 'lg:max-w-md',
  },
  {
    key: 'timeout',
    label: S.timeLimit,
    align: 'right',
    cell: (s) => <span className="tabular-nums">{formatSeconds(s.timeoutSec)}</span>,
  },
  {
    key: 'outputs',
    label: S.creates,
    header: (
      <span className="inline-flex items-center gap-1">
        {S.creates}
        <InfoTip tip={S.createsTip} label={S.creates} />
      </span>
    ),
    cell: (s) =>
      (s.outputs ?? []).length === 0 ? (
        <span className="text-dim">—</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {(s.outputs ?? []).map((o) => (
            <code key={o} className={code}>
              {o}
            </code>
          ))}
        </span>
      ),
  },
];

/**
 * "Setup may use the network" (ADR-0027 §2): an owner-only project switch, off by default, saved
 * at once through the setup PUT's `setupNetwork`. A real switch (role="switch") with its words
 * next to it, so its state never rests on color.
 */
function NetworkSwitch({
  projectId,
  setup,
  networkSteps,
}: {
  projectId: string;
  setup: ProjectAgentSetupDto | undefined;
  networkSteps: number;
}) {
  const id = useId();
  const invalidate = useMemo(() => {
    const a = isProjectSetupPath(projectId);
    const b = isWorkflowGraphPath(projectId);
    return (key: string) => a(key) || b(key);
  }, [projectId]);
  const save = useSetupAction(updateProjectSetup, invalidate);
  const on = setup?.setupNetwork === true;
  const toggle = () => {
    if (setup === undefined || save.pending) return;
    const body = networkRequest(setup, !on);
    if (body !== null) void save.run(projectId, body);
  };
  return (
    <div
      className="flex flex-col gap-2"
      data-testid="setup-network"
      data-on={on ? 'true' : 'false'}
    >
      <div className="flex items-start gap-3 rounded-control border border-line px-3 py-3">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          disabled={setup === undefined || save.pending}
          onClick={toggle}
          className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 ${
            on ? 'border-accent-fill-edge bg-accent-fill' : 'border-line-strong bg-sunken'
          }`}
          data-testid="setup-network-switch"
        >
          <span
            aria-hidden="true"
            className={`inline-block size-3.5 rounded-full bg-panel shadow-card transition-transform duration-150 motion-reduce:transition-none ${
              on ? 'translate-x-[1.125rem]' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span id={`${id}-label`} className="flex items-center gap-2 font-medium">
            {N.label}
            <span className="text-caption font-normal text-dim" aria-hidden="true">
              {save.pending ? N.saving : on ? N.on : N.off}
            </span>
          </span>
          <span id={`${id}-hint`} className="text-caption text-dim">
            {N.hint}
          </span>
          <span className="text-caption" data-testid="setup-network-effect">
            {networkSteps === 0 ? (
              <span className="text-dim">{N.noneUses}</span>
            ) : on ? null : (
              <span className="text-warning">{N.blocked(networkSteps)}</span>
            )}
          </span>
        </div>
      </div>
      <ActionError error={save.error} message={N.failed} />
    </div>
  );
}

/**
 * The harness's setup steps (ADR-0027 §1): name, command, time limit, "Uses the network" and the
 * folders each creates; the network switch; and the latest setup runs on the main branch
 * ("Run setup and checks now"), each with its status and output.
 */
export function SetupCard({
  projectId,
  harness,
  setup,
  latest,
  className = '',
}: {
  projectId: string;
  harness: HarnessStatusDto;
  setup: ProjectAgentSetupDto | undefined;
  /** The latest setup runs on main; undefined while unknown. */
  latest: readonly SetupRunDto[] | undefined;
  className?: string;
}) {
  const steps = setupSteps(harness);
  const networkSteps = steps.filter((s) => s.network === true).length;
  return (
    <Card
      title={S.title}
      description={S.description}
      tip={S.tip}
      padded={false}
      className={className}
      testId="harness-setup"
    >
      <DataTable
        label={S.label}
        columns={COLUMNS}
        rows={steps}
        rowKey={(s) => s.id}
        rowAttributes={(s) => ({ 'data-step': s.id })}
        empty={
          <div className="px-4 pt-4">
            <EmptyState compact title={S.none} text={S.noneText} />
          </div>
        }
      />
      <div className="flex flex-col gap-5 p-4">
        <NetworkSwitch projectId={projectId} setup={setup} networkSteps={networkSteps} />
        {latest !== undefined && latest.length > 0 ? (
          <section aria-label={L.title} className="flex flex-col gap-2" data-testid="latest-setup">
            <h3 className="font-semibold">{L.title}</h3>
            <SetupRunList runs={latest} label={L.label} />
          </section>
        ) : steps.length > 0 ? (
          <p className="text-caption text-dim" data-testid="latest-setup-none">
            {L.none}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
