import { useId, useState } from 'react';
import { Button, buttonClass } from '../../components/Button';
import { inputClass } from '../../components/Input';

/**
 * A button that opens a small form asking for a sentence first (merge anyway with a reason, rework
 * or request changes with a comment). Nothing is sent without text; a refusal keeps the form and
 * the text, with the server's answer shown by the caller.
 */
export function ReasonForm({
  openLabel,
  title,
  label,
  hint,
  placeholder,
  max,
  tooLong,
  submitLabel,
  cancelLabel,
  pendingLabel,
  pending,
  tone = 'neutral',
  testId,
  extra,
  onConfirm,
}: {
  openLabel: string;
  title: string;
  label: string;
  hint: string;
  placeholder: string;
  max: number;
  tooLong: string;
  submitLabel: string;
  cancelLabel: string;
  pendingLabel: string;
  pending: boolean;
  /** `danger` for merging past a failed check. */
  tone?: 'neutral' | 'danger';
  testId: string;
  /** An extra line under the hint (e.g. that this rework goes past the limit). */
  extra?: string | undefined;
  /** Resolves to null when refused. */
  onConfirm: (text: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const id = useId();
  const trimmed = text.trim();
  const long = trimmed.length > max;
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} disabled={pending}>
        {openLabel}
      </Button>
    );
  }
  return (
    <form
      role="group"
      aria-label={title}
      data-testid={testId}
      className={`flex w-full flex-col gap-2 rounded-control border px-3 py-2.5 ${
        tone === 'danger' ? 'border-danger/30 bg-danger-soft' : 'border-line-strong bg-sunken'
      }`}
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed.length === 0 || long) return;
        void onConfirm(trimmed).then((done) => {
          if (done !== null) {
            setOpen(false);
            setText('');
          }
        });
      }}
    >
      <p className="font-medium">{title}</p>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-describedby={`${id}-hint`}
        aria-invalid={long ? true : undefined}
        // The text comes first, so focus lands in the box.
        autoFocus
        className={inputClass('resize-y px-3 py-2')}
      />
      <span id={`${id}-hint`} className="text-caption text-dim">
        {long ? <span className="text-danger">{tooLong}</span> : hint}
        {extra !== undefined && !long ? (
          <span className="mt-0.5 block text-warning">{extra}</span>
        ) : null}
      </span>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className={buttonClass(tone === 'danger' ? 'danger' : 'primary')}
          disabled={pending || trimmed.length === 0 || long}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
        <Button onClick={() => setOpen(false)} disabled={pending}>
          {cancelLabel}
        </Button>
      </div>
    </form>
  );
}
