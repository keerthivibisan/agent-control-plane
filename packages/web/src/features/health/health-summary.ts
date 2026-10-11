import type { DiagnosticsDto } from '@acp/core/api';
import { HEALTH_COPY } from '../../lib/copy';

export interface HealthProblem {
  key:
    | 'fileIssues'
    | 'parseErrors'
    | 'unknownRecords'
    | 'pollErrors'
    | 'failedBatches'
    | 'invalidEvents';
  count: number;
  text: string;
}

export interface HealthSummary {
  state: 'first-read' | 'good' | 'attention';
  /** Files the app tracks (one row per source file it has read). */
  filesRead: number;
  /** Only the problems that occurred, largest first. */
  problems: HealthProblem[];
}

const sum = (xs: readonly number[]) => xs.reduce((n, x) => n + x, 0);

/**
 * Turns the diagnostics counters into the page's one-line verdict. Skipped-on-purpose records and
 * resolved conflicts are not problems: the app handled them by design.
 *
 * Damaged lines are counted two ways: per file (stored, survives restarts) and per adapter (since
 * the server started). Adding them would count a line twice, so the larger of the two is used.
 */
export function summarizeHealth(d: DiagnosticsDto): HealthSummary {
  const P = HEALTH_COPY.problems;
  const parseErrors = Math.max(
    sum(d.sources.map((s) => s.parseErrors)),
    sum(d.adapters.map((a) => a.parseErrors)),
  );
  const counts: [HealthProblem['key'], number, (n: number) => string][] = [
    ['fileIssues', sum(d.adapters.map((a) => a.fileIssues.length)), P.fileIssues],
    ['parseErrors', parseErrors, P.parseErrors],
    ['unknownRecords', sum(d.unrecognized.map((u) => u.count)), P.unknownRecords],
    ['pollErrors', d.ingestion.scheduler.pollErrors, P.pollErrors],
    ['failedBatches', d.ingestion.pipeline.batchesFailed, P.failedBatches],
    ['invalidEvents', d.ingestion.pipeline.eventsInvalid, P.invalidEvents],
  ];
  const problems = counts
    .filter(([, n]) => n > 0)
    .map(([key, count, text]) => ({ key, count, text: text(count) }));
  const firstRead = d.ingestion.scheduler.polls === 0 && d.sources.length === 0;
  return {
    state: problems.length > 0 ? 'attention' : firstRead ? 'first-read' : 'good',
    filesRead: d.sources.length,
    problems,
  };
}
