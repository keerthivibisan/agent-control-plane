import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { inputClass } from '../../components/Input';
import { Popover } from '../../components/Popover';
import type { ApiError } from '../../lib/api';
import { formatCount } from '../../lib/format';
import { ActionError } from '../control/bits';
import { defaultChoice, type ReviewChoice, type ReviewChoiceId } from './choices';
import { compileFor } from './compile';
import { REVIEW_PAGE_COPY as T } from './copy';
import type { PendingReview } from './pending-review';

/**
 * "Review changes" (v0.3.0 D-A), GitHub's review popover: an overall comment, the choices the
 * owner can make now (the others disabled with the reason), a preview of the text that is sent,
 * its length against the endpoint's limit, and Submit. A review over the limit is never cut: the
 * popover says so and Submit waits.
 */
export function ReviewPopover({
  review,
  choices,
  compileOptions,
  onSummary,
  onSend,
  pending,
  error,
}: {
  review: PendingReview;
  choices: readonly ReviewChoice[];
  compileOptions: { commit?: string | null; order?: (path: string) => number };
  onSummary: (text: string) => void;
  /** Sends the text with the choice; resolves true when it went through. */
  onSend: (choice: ReviewChoiceId, text: string) => Promise<boolean>;
  pending: boolean;
  error: ApiError | null;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ReviewChoiceId | null>(null);
  // A choice that closed since it was picked (the change moved on) falls back to the default.
  const choiceId =
    picked !== null && choices.some((c) => c.id === picked && c.enabled)
      ? picked
      : defaultChoice(choices);
  const choice = choices.find((c) => c.id === choiceId) ?? choices[choices.length - 1];
  const max = choice?.max ?? 0;
  const compiled = compileFor(review, max, compileOptions);
  const count = review.comments.length;
  const label = choice === undefined ? '' : T.choices[choice.id].label;

  const submit = async () => {
    if (choice === undefined || compiled.empty || !compiled.fits || !choice.enabled) return;
    if (await onSend(choice.id, compiled.text)) setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      label={T.popover}
      testId="review-popover"
      className="w-[30rem]"
      trigger={
        <Button
          variant="primary"
          size="sm"
          aria-label={T.reviewButtonLabel(count)}
          data-testid="review-changes"
        >
          {T.reviewButton}
          {count > 0 ? (
            <span
              aria-hidden="true"
              className="rounded-full bg-primary-ink/20 px-1.5 text-micro font-semibold tabular-nums"
              data-testid="review-count"
            >
              {formatCount(count)}
            </span>
          ) : null}
        </Button>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-title font-semibold">{T.popoverTitle}</h2>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-summary`} className="text-caption font-medium text-ink">
            {T.summaryLabel}
          </label>
          <textarea
            id={`${id}-summary`}
            rows={4}
            value={review.summary}
            placeholder={T.summaryPlaceholder}
            onChange={(e) => onSummary(e.target.value)}
            aria-describedby={`${id}-summary-hint`}
            className={inputClass('min-h-24 resize-y font-sans')}
            data-testid="review-summary"
          />
          <p id={`${id}-summary-hint`} className="text-caption text-dim">
            {T.summaryHint} {T.pendingCount(count)}
          </p>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-caption font-medium text-ink">{T.choiceLegend}</legend>
          {choices.map((c) => {
            const cid = `${id}-${c.id}`;
            return (
              <div
                key={c.id}
                className="flex items-start gap-2"
                data-testid={`review-choice-${c.id}`}
              >
                <input
                  id={cid}
                  type="radio"
                  name={`${id}-choice`}
                  value={c.id}
                  checked={choiceId === c.id}
                  disabled={!c.enabled}
                  onChange={() => setPicked(c.id)}
                  aria-describedby={`${cid}-text`}
                  className="mt-1 accent-accent"
                />
                <div className="min-w-0">
                  <label
                    htmlFor={cid}
                    className={`font-medium ${c.enabled ? 'text-ink' : 'text-dim'}`}
                  >
                    {T.choices[c.id].label}
                  </label>
                  <p id={`${cid}-text`} className="text-caption text-dim">
                    {c.enabled ? T.choices[c.id].text : c.reason}
                  </p>
                </div>
              </div>
            );
          })}
        </fieldset>
        {compiled.empty ? (
          <p className="text-caption text-dim" data-testid="review-empty">
            {T.empty}
          </p>
        ) : compiled.fits ? (
          <p className="text-caption text-dim tabular-nums" data-testid="review-length">
            {T.length(compiled.length, max)}
          </p>
        ) : (
          <p
            role="alert"
            className="rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-caption text-danger"
            data-testid="review-too-long"
          >
            {T.tooLong(compiled.length, label, max)}
          </p>
        )}
        {!compiled.empty ? (
          <Details summary={T.preview}>
            <pre
              className="max-h-48 overflow-auto rounded-control border border-line bg-sunken px-3 py-2 font-mono text-caption whitespace-pre-wrap"
              data-testid="review-preview"
            >
              {compiled.text}
            </pre>
          </Details>
        ) : null}
        <ActionError error={error} message={T.failed} />
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            disabled={pending || compiled.empty || !compiled.fits || choice?.enabled !== true}
            data-testid="review-submit"
          >
            {pending ? T.sending : T.submit}
          </Button>
        </div>
      </form>
    </Popover>
  );
}
