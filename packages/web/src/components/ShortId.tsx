import { useEffect, useState } from 'react';
import { idPrefix } from '../lib/format';
import { CheckIcon, CopyIcon } from './icons';

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * An id shortened to 8 characters, with a button that copies the full id. Full ids otherwise
 * appear only inside "Technical details" (DESIGN.md, Formatting).
 */
export function ShortId({
  id,
  label = 'id',
  writeText = (text: string) => navigator.clipboard.writeText(text),
}: {
  id: string;
  /** What the id is, for the copy button's name: "Copy session id". */
  label?: string;
  /** Injected for tests; defaults to the Clipboard API. */
  writeText?: (text: string) => Promise<void>;
}) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 1500);
    return () => clearTimeout(t);
  }, [state]);

  const copy = () => {
    // The Clipboard API is missing on insecure origins and can throw synchronously or reject.
    try {
      writeText(id).then(
        () => setState('copied'),
        () => setState('failed'),
      );
    } catch {
      setState('failed');
    }
  };

  return (
    <span className="inline-flex items-center gap-1 align-middle" data-id={id}>
      <code className="font-mono text-caption text-dim">{idPrefix(id)}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="inline-flex size-5 items-center justify-center rounded text-dim hover:bg-sunken hover:text-ink"
      >
        {state === 'copied' ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      </button>
      <span role="status" className="text-caption text-dim">
        {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : ''}
      </span>
    </span>
  );
}
