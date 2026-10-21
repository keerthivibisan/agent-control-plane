import type { TicketCommentDto } from '@acp/core/api';
import { MergeIcon, RunSummaryIcon } from '../../components/icons';
import { Badge } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { RUN_SUMMARY_COPY } from '../../lib/copy';
import { parseMergeLine, parseRunSummary, type MergeNote, type SummaryBlock } from './run-summary';

const C = RUN_SUMMARY_COPY;

/** "Agent Control Plane": who wrote a comment by author `app`. */
export function AppAuthor() {
  return (
    <Badge testId="comment-author" title={C.authorTip}>
      {C.author}
    </Badge>
  );
}

function Block({ block }: { block: SummaryBlock }) {
  if (block.type === 'heading') {
    return <h5 className="mt-1 text-caption font-semibold text-ink first:mt-0">{block.text}</h5>;
  }
  if (block.type === 'list') {
    return (
      <ul className="flex flex-col gap-0.5">
        {block.items.map((item, i) => (
          <li
            key={i}
            className="relative pl-4 before:absolute before:top-[0.6rem] before:left-1 before:size-1 before:rounded-full before:bg-dim"
            style={item.depth > 0 ? { marginLeft: `${item.depth}rem` } : undefined}
          >
            {item.text}
          </li>
        ))}
      </ul>
    );
  }
  return <p className="whitespace-pre-wrap">{block.lines.join('\n')}</p>;
}

/**
 * The run summary Agent Control Plane writes on the ticket when a run hands over or ends
 * (ADR-0024 §3): a card of its own, apart from your comments and the agents'. Lines ending with
 * a colon read as headings and "- " lines as lists; anything else shows as written.
 */
export function RunSummaryCard({
  comment,
  runLabel,
}: {
  comment: TicketCommentDto;
  /** "Run 2", when the comment belongs to one of this ticket's runs. */
  runLabel: string | null;
}) {
  const blocks = parseRunSummary(comment.body);
  return (
    <article
      className="overflow-hidden rounded-card border border-line bg-panel shadow-card"
      data-testid="run-summary"
      aria-label={runLabel ? `${C.title}, ${runLabel}` : C.title}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-sunken px-3.5 py-2 text-caption text-dim">
        <RunSummaryIcon size={15} className="text-ink" />
        <h4 className="font-semibold text-ink">{C.title}</h4>
        {runLabel ? <span>{runLabel}</span> : null}
        <AppAuthor />
        <span className="ml-auto">
          <RelativeTime iso={comment.createdAt} />
        </span>
      </header>
      <div className="flex flex-col gap-2 px-3.5 py-3 leading-6" data-testid="run-summary-body">
        {blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
    </article>
  );
}

/** The one-line note after your merge: "Merged acp/WEB-12 into main at 1a2b3c4", small and quiet. */
export function MergeLine({ comment, note }: { comment: TicketCommentDto; note: MergeNote }) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-dim"
      data-testid="merge-line"
    >
      <MergeIcon size={14} className="text-success" />
      <span className="sr-only">{C.author}: </span>
      <span>
        {C.merge.merged} <code className="font-mono text-ink">{note.branch}</code> {C.merge.into}{' '}
        <code className="font-mono text-ink">{note.into}</code> {C.merge.at}{' '}
        <code className="font-mono text-ink">{note.at}</code>
      </span>
      <span aria-hidden="true">·</span>
      <RelativeTime iso={comment.createdAt} />
    </p>
  );
}

/** How an `app` comment shows: the merge note as a line, anything else as a run summary card. */
export function AppComment({
  comment,
  runLabel,
}: {
  comment: TicketCommentDto;
  runLabel: string | null;
}) {
  const note = parseMergeLine(comment.body);
  return note ? (
    <MergeLine comment={comment} note={note} />
  ) : (
    <RunSummaryCard comment={comment} runLabel={runLabel} />
  );
}
