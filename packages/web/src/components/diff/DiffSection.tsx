import { useState } from 'react';
import { ChevronRightIcon } from '../icons';
import { DiffViewer } from './DiffViewer';

/**
 * A diff behind a disclosure, drawn only once it is opened: the viewer (and with it Shiki's
 * grammars) loads when the owner asks to see the lines, not with the card. It looks and behaves
 * like `Details` (a native <details>, so it opens with the keyboard) and stays drawn after it is
 * closed, so collapsed files and shown lines survive closing it.
 */
export function DiffSection({
  summary,
  diff,
  truncated,
  files,
  defaultOpen = false,
  testId,
}: {
  summary: string;
  diff: string;
  truncated: boolean;
  files?: readonly string[] | undefined;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [opened, setOpened] = useState(defaultOpen);
  return (
    <details
      open={defaultOpen}
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true);
      }}
      data-testid={testId}
      className="group rounded-card border border-line bg-panel"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-card px-3.5 py-2 text-dim transition-colors select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          size={15}
          className="transition-transform duration-150 group-open:rotate-90"
        />
        {summary}
      </summary>
      <div className="border-t border-line px-3.5 py-3">
        {opened ? <DiffViewer diff={diff} truncated={truncated} files={files} /> : null}
      </div>
    </details>
  );
}
