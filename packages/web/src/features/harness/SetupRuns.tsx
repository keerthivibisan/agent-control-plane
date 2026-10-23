import type { SetupRunDto } from '@acp/core/api';
import { ChevronRightIcon } from '../../components/icons';
import { HARNESS_BLOCKS_COPY, SETUP_STATUS_COPY } from '../../lib/copy';
import { formatDuration } from '../../lib/format';
import { StatusWord } from '../control/bits';

const T = HARNESS_BLOCKS_COPY.ticket;

/**
 * One setup step's run (ADR-0027 §1): its status in words (never color alone), name, time and
 * exit code, and the redacted end of its output in a native disclosure, open when it did not pass
 * (that is what the owner came for). Shared by the Harness page and the ticket's Checks tab.
 */
export function SetupRunRow({ run }: { run: SetupRunDto }) {
  const failed = run.status !== 'passed' && run.status !== 'interrupted';
  return (
    <li
      className="flex flex-col gap-2 px-3.5 py-2.5"
      data-testid={`setup-${run.stepId}`}
      data-status={run.status}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusWord status={SETUP_STATUS_COPY[run.status]} value={run.status} />
        <span className="font-medium">{run.name}</span>
        <span className="ml-auto text-caption text-dim tabular-nums">
          {T.took(formatDuration(run.durationMs))} · {T.exitCode(run.exitCode)}
        </span>
      </div>
      <details open={failed} className="group/output">
        <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-control text-caption text-dim transition-colors select-none hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            size={14}
            className="transition-transform duration-150 group-open/output:rotate-90 motion-reduce:transition-none"
          />
          {T.output}
        </summary>
        {run.outputTail.length > 0 ? (
          <pre className="mt-2 max-h-64 overflow-auto rounded-control border border-line bg-sunken px-3 py-2.5 font-mono text-caption leading-5 whitespace-pre-wrap">
            {run.outputTail}
          </pre>
        ) : (
          <p className="mt-2 text-caption text-dim">{T.noOutput}</p>
        )}
      </details>
    </li>
  );
}

/** A list of setup runs in a bordered box, in run order. */
export function SetupRunList({ runs, label }: { runs: readonly SetupRunDto[]; label: string }) {
  return (
    <ul
      aria-label={label}
      className="flex flex-col divide-y divide-line overflow-hidden rounded-control border border-line"
    >
      {runs.map((r) => (
        <SetupRunRow key={r.id} run={r} />
      ))}
    </ul>
  );
}
