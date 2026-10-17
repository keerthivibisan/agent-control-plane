import type { CapabilitiesDto } from '@acp/core/api';
import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, InfoIcon } from '../../components/icons';
import { SETUP_COPY } from '../../lib/copy';

const C = SETUP_COPY.hooks;

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * A command or URL in a box with a copy button. A local variant of ShortId's copy behavior for
 * longer text (ShortId truncates to 8 characters by design).
 */
export function CopyableCode({
  text,
  label,
  writeText = (t: string) => navigator.clipboard.writeText(t),
}: {
  text: string;
  /** What is copied, for the button's accessible name: "Copy command". */
  label: string;
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
      writeText(text).then(
        () => setState('copied'),
        () => setState('failed'),
      );
    } catch {
      setState('failed');
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-control border border-line bg-sunken py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 font-mono text-caption break-all">{text}</code>
      <span role="status" className="text-caption text-dim">
        {state === 'copied'
          ? SETUP_COPY.copy.copied
          : state === 'failed'
            ? SETUP_COPY.copy.failed
            : ''}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={SETUP_COPY.copy.action(label)}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-dim transition-colors hover:bg-hover hover:text-ink"
      >
        {state === 'copied' ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      </button>
    </div>
  );
}

/** Whether a hook has ever arrived: a dot and a sentence (color is never the only signal). */
export function HookConnection({ hooks }: { hooks: CapabilitiesDto['hooks'] }) {
  return (
    <p
      data-testid="hooks-status"
      data-received={hooks.receivedAny ? 'true' : 'false'}
      className="inline-flex items-center gap-2 font-medium"
    >
      <span
        aria-hidden="true"
        className={`inline-block size-2.5 shrink-0 rounded-full ${
          hooks.receivedAny ? 'bg-status-active' : 'border-2 border-status-stale'
        }`}
      />
      {hooks.receivedAny ? C.received : C.notReceived}
    </p>
  );
}

/**
 * Step 3 on Setup: what hooks add, in plain words, and how to turn them on. The app only prints the
 * settings (AGENTS.md §3.6): the user pastes them into their own Claude Code settings.
 */
export function HooksSetup({ caps }: { caps: CapabilitiesDto }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <HookConnection hooks={caps.hooks} />
        {caps.mode === 'demo' ? <p className="text-dim">{C.demo}</p> : null}
      </div>
      <div>
        <h3 className="mb-2 font-semibold">{C.whatTheyAdd}</h3>
        <ul className="flex flex-col gap-1">
          {C.benefits.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <CheckIcon size={16} className="mt-0.5 shrink-0 text-success" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 font-semibold">{C.stepsTitle}</h3>
        <ol className="flex list-decimal flex-col gap-3 pl-5 marker:text-dim">
          <li className="pl-1">
            <p className="mb-1.5">{C.steps.print}</p>
            <CopyableCode text={C.command} label={C.commandName} />
          </li>
          <li className="pl-1">{C.steps.paste}</li>
          <li className="pl-1">{C.steps.token}</li>
          <li className="pl-1">{C.steps.restart}</li>
        </ol>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-dim">{C.receiverLabel}</p>
        <CopyableCode text={caps.hooks.receiverUrl} label={C.receiverName} />
      </div>
      <p className="flex items-start gap-2 rounded-control border border-line bg-sunken/60 px-3 py-2.5 text-dim">
        <InfoIcon size={16} className="mt-0.5 shrink-0" />
        <span>
          {C.neverEdits} {C.serverDown}
        </span>
      </p>
    </div>
  );
}
