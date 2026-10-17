import type { HarnessStatusDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { Pill } from '../../components/Pill';
import { formatSeconds, HARNESS_PAGE_COPY } from '../../lib/copy';

const C = HARNESS_PAGE_COPY.checks;

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

/** Each check the harness lists: name, command, folder, time limit, required or optional. */
export function ChecksCard({
  harness,
  className = '',
}: {
  harness: HarnessStatusDto;
  className?: string;
}) {
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
          columns={COLUMNS}
          rows={harness.checks}
          rowKey={(c) => c.id}
          rowAttributes={(c) => ({ 'data-check': c.id })}
          empty={<EmptyState compact title={C.none} text={C.noneText} />}
        />
      </div>
    </Card>
  );
}
