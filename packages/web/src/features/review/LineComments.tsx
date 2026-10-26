import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Pill';
import { inputClass } from '../../components/Input';
import { lineRef } from './compile';
import { REVIEW_PAGE_COPY as T } from './copy';
import type { CommentSide, PendingComment } from './pending-review';

/**
 * A pending comment under its line, and the box to write or edit one (v0.3.0 D-A), GitHub's
 * inline review comment: the author, a "Pending" label, the text, Edit and Delete. Ctrl+Enter
 * (⌘+Enter) saves, Escape cancels; focus goes back to the line's "+" button.
 */

/** "line 42 (after)" for people; `compile.ts` writes "(new)" for the agents. */
export function readableRef(c: { line: number; endLine: number; side: CommentSide }): string {
  return T.lineRef(c.line, c.endLine, c.side);
}

export function CommentForm({
  label,
  initial = '',
  submitLabel,
  max,
  onSubmit,
  onCancel,
  onTextChange,
  testId = 'review-comment-form',
}: {
  /** What the comment is on, for the label ("src/api.ts line 42 (after)"). */
  label: string;
  initial?: string;
  submitLabel: string;
  max: number;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  /** Follows the text as it is typed (a range moving the box keeps it). */
  onTextChange?: (text: string) => void;
  testId?: string;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  const tooLong = text.trim().length > max;
  const empty = text.trim().length === 0;
  const submit = () => {
    if (!empty && !tooLong) onSubmit(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };
  return (
    <form
      className="flex flex-col gap-2 rounded-card border border-line bg-panel p-2 shadow-card"
      data-testid={testId}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="text-caption font-medium text-ink">
        {T.formLabel(label)}
      </label>
      <textarea
        id={id}
        // The box opens on the owner's click or key on the line: typing goes straight in.
        autoFocus
        rows={3}
        value={text}
        placeholder={T.formPlaceholder}
        aria-invalid={tooLong ? true : undefined}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setText(e.target.value);
          onTextChange?.(e.target.value);
        }}
        onKeyDown={onKeyDown}
        className={inputClass('min-h-20 resize-y font-sans')}
      />
      <div className="flex flex-wrap items-center gap-2">
        <p
          id={`${id}-hint`}
          className={`min-w-0 flex-1 text-caption ${tooLong ? 'text-danger' : 'text-dim'}`}
        >
          {tooLong ? T.tooLongComment(max) : T.formHint}
        </p>
        <Button size="sm" onClick={onCancel}>
          {T.cancel}
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={empty || tooLong}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function CommentCard({
  comment,
  commit,
  max,
  editing,
  onEdit,
  onSave,
  onCancelEdit,
  onDelete,
  showPath = false,
}: {
  comment: PendingComment;
  /** The change's current commit, to mark a comment written on an earlier one. */
  commit: string | null;
  max: number;
  editing: boolean;
  onEdit: () => void;
  onSave: (body: string) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  /** Off its line (the list at the top), the comment names its file. */
  showPath?: boolean;
}) {
  const ref = readableRef(comment);
  const where = showPath ? `${comment.path} ${ref}` : ref;
  if (editing) {
    return (
      <CommentForm
        label={where}
        initial={comment.body}
        submitLabel={T.save}
        max={max}
        onSubmit={onSave}
        onCancel={onCancelEdit}
        testId="review-comment-edit"
      />
    );
  }
  const outdated = comment.commit !== null && commit !== null && comment.commit !== commit;
  return (
    <article
      aria-label={T.formLabel(where)}
      className="flex flex-col gap-1.5 rounded-card border border-line bg-panel px-3 py-2 shadow-card"
      data-testid="review-comment"
      data-ref={lineRef(comment)}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
        <span className="font-semibold text-ink">{T.you}</span>
        <Badge tone="warning">{T.pending}</Badge>
        <span className="text-dim">
          {showPath ? <span className="font-mono">{comment.path} </span> : null}
          {ref}
        </span>
        {outdated && comment.commit !== null ? (
          <span className="text-dim">· {T.outdated(comment.commit.slice(0, 7))}</span>
        ) : null}
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="quiet" onClick={onEdit} aria-label={T.editLabel(where)}>
            {T.edit}
          </Button>
          <Button size="sm" variant="quiet" onClick={onDelete} aria-label={T.deleteLabel(where)}>
            {T.delete}
          </Button>
        </span>
      </header>
      <p className="text-body break-words whitespace-pre-wrap text-ink">{comment.body}</p>
    </article>
  );
}
