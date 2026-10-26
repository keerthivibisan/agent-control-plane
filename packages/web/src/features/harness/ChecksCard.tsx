import type { WorkflowGraph } from '@acp/core';
import type { HarnessStatusDto } from '@acp/core/api';
import { useMemo } from 'react';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { InfoTip } from '../../components/InfoTip';
import { Badge, Pill } from '../../components/Pill';
import { formatSeconds, HARNESS_BLOCKS_COPY, HARNESS_PAGE_COPY } from '../../lib/copy';
import { blocksRunningCheck, checkPlaceOf } from '../workflow/check-blocks';

const C = HARNESS_PAGE_COPY.checks;
const WH = HARNESS_BLOCKS_COPY.harness.where;

type Check = HarnessStatusDto['checks'][number];

/** Required or optional, with what that means in the tooltip. */
export function RequiredPill({ required }: { required: boolean }) {
  return (
    <Pill
      tone={required ? 'accent' : 'neutral'}
      dot={false}
      title={required ? C.requiredTip : C.optionalTip}
    >
      {required ? C.required : C.optional}
    </Pill>
  );
}

const COLUMNS: readonly Column<Check>[] = [
  {
    key: 'name',
    label: C.name,
    cell: (c) => (
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{c.name}</span>
        <RequiredPill required={c.required} />
      </span>
    ),
  },
  {
    key: 'command',
    label: C.command,
    // The argv as the server runs it, word by word; never a shell line (ADR-0017 §3).
    cell: (c) => (
      <code className="rounded-[0.3125rem] border border-line bg-sunken px-1.5 py-0.5 font-mono text-caption break-all">
        {c.argv.join(' ')}
      </code>
    ),
    className: 'lg:max-w-md',
  },
  {
    key: 'folder',
    label: C.folder,
    cell: (c) =>
      c.cwd === undefined ? (
        <span className="text-dim">{C.projectFolder}</span>
      ) : (
        <code className="font-mono text-caption">{c.cwd}</code>
      ),
  },
  {
    key: 'timeout',
    label: C.timeLimit,
    align: 'right',
    cell: (c) => <span className="tabular-nums">{formatSeconds(c.timeoutSec)}</span>,
  },
];

/** A check's labels (ADR-0027 §4), the groups a Checks block can pick. */
const LABELS: Column<Check> = {
  key: 'labels',
  label: WH.labels,
  cell: (c) =>
    (c.labels ?? []).length === 0 ? (
      <span className="text-dim">—</span>
    ) : (
      <span className="flex flex-wrap gap-1">
        {(c.labels ?? []).map((l) => (
          <Badge key={l} mono>
            {l}
          </Badge>
        ))}
      </span>
    ),
};

/** Where each check runs: the workflow's Checks blocks that pick it, by place and name. */
function whereColumn(graph: WorkflowGraph): Column<Check> {
  return {
    key: 'where',
    label: WH.column,
    header: (
      <span className="inline-flex items-center gap-1">
        {WH.column}
        <InfoTip tip={WH.tip} label={WH.column} />
      </span>
    ),
    cell: (c) => {
      const blocks = blocksRunningCheck(graph, c);
      if (blocks.length === 0) return <span className="text-dim">{WH.none}</span>;
      return (
        <ul className="flex flex-col gap-0.5 text-caption" data-testid="check-where">
          {blocks.map((b) => (
            <li key={b.id} data-place={checkPlaceOf(b)}>
              {WH.block(HARNESS_BLOCKS_COPY.places[checkPlaceOf(b)], b.label)}
            </li>
          ))}
        </ul>
      );
    },
  };
}

/**
 * Each check the harness lists: name, command, folder, time limit, required or optional, its
 * labels and, with the project's workflow graph, where it runs (ADR-0027 §5).
 */
export function ChecksCard({
  harness,
  graph,
  className = '',
}: {
  harness: HarnessStatusDto;
  /** The project's workflow graph; undefined while unknown or on a server without graphs. */
  graph?: WorkflowGraph | undefined;
  className?: string;
}) {
  const columns = useMemo(() => {
    const labelled = harness.checks.some((c) => (c.labels ?? []).length > 0);
    return [
      ...COLUMNS.slice(0, 1),
      ...(labelled ? [LABELS] : []),
      ...COLUMNS.slice(1),
      ...(graph === undefined ? [] : [whereColumn(graph)]),
    ];
  }, [harness.checks, graph]);
  return (
    <Card
      title={C.title}
      description={C.description}
      tip={C.tip}
      padded={false}
      className={className}
      testId="harness-checks"
    >
      <div className="pb-2">
        <DataTable
          label={C.label}
          columns={columns}
          rows={harness.checks}
          rowKey={(c) => c.id}
          rowAttributes={(c) => ({ 'data-check': c.id })}
          empty={<EmptyState compact title={C.none} text={C.noneText} />}
        />
      </div>
    </Card>
  );
}
