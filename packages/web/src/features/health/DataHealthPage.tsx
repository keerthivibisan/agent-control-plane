import type { DiagnosticsDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { DataTable, type Column } from '../../components/DataTable';
import { Details } from '../../components/Details';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { paths, schemas } from '../../lib/api';
import { HEALTH_COPY, PAGES, TECH_LABELS } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import {
  CapabilitiesCard,
  FileProblemsCard,
  HealthVerdict,
  ParseErrorsCard,
  ReadingCard,
  SkippedCard,
  UnknownCard,
} from './HealthCards';
import { summarizeHealth } from './health-summary';

type Source = DiagnosticsDto['sources'][number];

const mono = 'font-mono text-caption break-all';

const SOURCE_COLUMNS: readonly Column<Source>[] = [
  {
    key: 'file',
    label: TECH_LABELS.file,
    cell: (s) => <span className={mono}>{s.sourcePath}</span>,
  },
  {
    key: 'read',
    label: TECH_LABELS.bytesRead,
    align: 'right',
    cell: (s) => <span className={mono}>{s.byteOffset}</span>,
  },
  {
    key: 'size',
    label: TECH_LABELS.size,
    align: 'right',
    cell: (s) => <span className={mono}>{s.sizeBytes}</span>,
  },
  {
    key: 'errors',
    label: TECH_LABELS.parseErrors,
    align: 'right',
    cell: (s) => <span className={mono}>{s.parseErrors}</span>,
  },
  {
    key: 'at',
    label: TECH_LABELS.updatedAt,
    cell: (s) => <span className={mono}>{s.updatedAt}</span>,
  },
];

/** Every counter by its API name, for anyone who wants the raw numbers. */
function rawCounters(d: DiagnosticsDto): [string, string][] {
  const rows: [string, string][] = [
    ['ingestion.scheduler.polls', String(d.ingestion.scheduler.polls)],
    ['ingestion.scheduler.pollErrors', String(d.ingestion.scheduler.pollErrors)],
    ['ingestion.scheduler.lastPollAt', d.ingestion.scheduler.lastPollAt ?? 'null'],
    ['ingestion.pipeline.batchesFailed', String(d.ingestion.pipeline.batchesFailed)],
    ['ingestion.pipeline.eventsInvalid', String(d.ingestion.pipeline.eventsInvalid)],
    ['edgeConflictCount', String(d.edgeConflictCount)],
    ['usageConflictCount', String(d.usageConflictCount)],
  ];
  for (const a of d.adapters) {
    rows.push([`adapters.${a.provider}.parseErrors`, String(a.parseErrors)]);
    for (const f of a.fileIssues) {
      rows.push([
        `adapters.${a.provider}.fileIssues ${f.path}`,
        `${f.reason}${f.detail ? ` (${f.detail})` : ''}`,
      ]);
    }
  }
  return rows;
}

function RawDetails({ d }: { d: DiagnosticsDto }) {
  const counters = rawCounters(d);
  return (
    <Details summary={HEALTH_COPY.raw} testId="health-raw">
      <div className="flex flex-col gap-4">
        <DataTable
          label={TECH_LABELS.counter}
          columns={[
            {
              key: 'k',
              label: TECH_LABELS.counter,
              cell: (r) => <code className={mono}>{r[0]}</code>,
            },
            {
              key: 'v',
              label: TECH_LABELS.value,
              cell: (r) => <span className={mono}>{r[1]}</span>,
            },
          ]}
          rows={counters}
          rowKey={(r) => r[0]}
        />
        {d.sources.length > 0 ? (
          <DataTable
            label={TECH_LABELS.file}
            columns={SOURCE_COLUMNS}
            rows={d.sources}
            rowKey={(s) => s.sourcePath}
          />
        ) : null}
      </div>
    </Details>
  );
}

/**
 * `#/health`: is the data trustworthy? A verdict first, then what was skipped and why. `tabs`
 * (Data health's section switcher) sits under the title, as on every other page.
 */
export function DataHealthPage({ tabs }: { tabs?: ReactNode } = {}) {
  const diagnostics = useApiQuery(paths.diagnostics(), schemas.diagnostics);
  const caps = useApiQuery(paths.capabilities(), schemas.capabilities);
  return (
    <div>
      <PageHeader
        title={PAGES.health.title}
        description={
          <>
            <span className="font-medium text-ink">{HEALTH_COPY.heading}</span>{' '}
            {PAGES.health.description}
          </>
        }
      />
      {tabs}
      <div className="flex flex-col gap-6">
        <QueryView query={diagnostics}>
          {(d) => (
            <div className="flex flex-col gap-6">
              <HealthVerdict summary={summarizeHealth(d)} />
              <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
                <FileProblemsCard adapters={d.adapters} />
                <ParseErrorsCard d={d} />
                <SkippedCard adapters={d.adapters} />
                <UnknownCard unrecognized={d.unrecognized} />
              </div>
              <ReadingCard d={d} />
            </div>
          )}
        </QueryView>
        <QueryView query={caps}>{(c) => <CapabilitiesCard caps={c} />}</QueryView>
        {diagnostics.data ? <RawDetails d={diagnostics.data} /> : null}
      </div>
    </div>
  );
}
