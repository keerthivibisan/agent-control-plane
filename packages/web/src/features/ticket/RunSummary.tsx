import type { TicketCommentDto } from '@acp/core/api';
import { Details } from '../../components/Details';
import { MergeIcon, RunSummaryIcon } from '../../components/icons';
import { Badge } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { RUN_SUMMARY_COPY } from '../../lib/copy';
import { PullRequestIcon } from '../branching/icons';
import {
  parseMergeLine,
  parseRunSummary,
  splitRunSummary,
  type MergeNote,
  type SummaryBlock,
} from './run-summary';

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

function Blocks({ blocks }: { blocks: readonly SummaryBlock[] }) {
  return blocks.map((b, i) => <Block key={i} block={b} />);
}

/**
 * The run summary Agent Control Plane writes on the ticket when a run hands over or ends
 * (ADR-0024 §3): a card of its own, apart from your comments and the agents'.
 *
 * Since v0.3.0 S-C it reads like a teammate's comment: the lead's note (or the app's one plain
 * sentence when there is none) as the text, and the facts the app recorded folded behind
 * "Details". An older summary, with no `Details:` line, shows as before: lines ending with a colon
 * read as headings and "- " lines as lists; anything else shows as written.
 */
export function RunSummaryCard({
  comment,
  runLabel,
}: {
  comment: TicketCommentDto;
  /** "Run 2", when the comment belongs to one of this ticket's runs. */
  runLabel: string | null;
}) {
  const human = splitRunSummary(comment.body);
  const base = human?.updated === true ? C.updatedTitle : C.title;
  const title = human !== null && human.note !== null ? `${C.lead} · ${base}` : base;
  return (
    <article
      className="overflow-hidden rounded-card border border-line bg-panel shadow-card"
      data-testid="run-summary"
      data-layout={human ? 'comment' : 'sections'}
      aria-label={runLabel ? `${title}, ${runLabel}` : title}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-sunken px-3.5 py-2 text-caption text-dim">
        <RunSummaryIcon size={15} className="text-ink" />
        <h4 className="font-semibold text-ink">{title}</h4>
        {runLabel ? <span>{runLabel}</span> : null}
        <AppAuthor />
        <span className="ml-auto">
          <RelativeTime iso={comment.createdAt} />
        </span>
      </header>
      <div className="flex flex-col gap-3 px-3.5 py-3 leading-6" data-testid="run-summary-body">
        {human ? (
          <>
            <p className="whitespace-pre-wrap text-ink" data-testid="run-summary-text">
              {human.text}
            </p>
            {human.details.length > 0 && (
              <Details summary={C.details} testId="run-summary-details">
                <div className="flex flex-col gap-2">
                  <Blocks blocks={human.details} />
                </div>
              </Details>
            )}
          </>
        ) : (
          <Blocks blocks={parseRunSummary(comment.body)} />
        )}
      </div>
    </article>
  );
}

function Code({ children }: { children: string }) {
  return <code className="font-mono text-ink">{children}</code>;
}

/** The sentence of a one-line note: branches and commits as code, a pull request's number as text. */
function NoteText({ note }: { note: MergeNote }) {
  const P = C.pullRequest;
  const detail =
    note.kind !== 'pr-pushed' && note.detail !== undefined ? (
      <span data-testid="merge-detail">{note.detail}</span>
    ) : null;
  if (note.kind === 'pr-merged') {
    return (
      <span>
        {P.mergedVia(note.number)} <Code>{note.into}</Code> {C.merge.at} <Code>{note.at}</Code>
        {detail}
      </span>
    );
  }
  if (note.kind === 'pr-pushed') {
    return note.opened ? (
      <span>
        {P.pushed} <Code>{note.branch}</Code> {P.opened(note.number)} <Code>{note.into}</Code>
      </span>
    ) : (
      <span>
        {P.pushed} <Code>{note.branch}</Code>
        {P.linked(note.number)} <Code>{note.into}</Code> {P.alreadyOpen}
      </span>
    );
  }
  return (
    <span>
      {C.merge.merged} <Code>{note.branch}</Code> {C.merge.into} <Code>{note.into}</Code>{' '}
      {C.merge.at} <Code>{note.at}</Code>
      {detail}
    </span>
  );
}

/**
 * A one-line note about the ticket branch, small and quiet: your merge ("Merged acp/WEB-12 into
 * main at 1a2b3c4"), the pull request merged on GitHub, or the branch pushed to a pull request.
 */
export function MergeLine({ comment, note }: { comment: TicketCommentDto; note: MergeNote }) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-dim"
      data-testid="merge-line"
      data-kind={note.kind}
    >
      {note.kind === 'pr-pushed' ? (
        <PullRequestIcon size={14} className="text-accent" />
      ) : (
        <MergeIcon size={14} className="text-success" />
      )}
      <span className="sr-only">{C.author}: </span>
      <NoteText note={note} />
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
