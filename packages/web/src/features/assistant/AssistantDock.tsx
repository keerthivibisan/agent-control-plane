import { useCallback, useRef, useState } from 'react';
import { AssistantIcon, CloseIcon } from '../../components/icons';
import { ASSISTANT_COPY } from '../../lib/copy';
import type { EventSourceFactory } from '../../lib/useEventStream';
import { AssistantPanel } from './AssistantPanel';
import { useAssistant } from './use-assistant';

const C = ASSISTANT_COPY;

/**
 * The floating project assistant (ADR-0035, AS-2): a round button at the bottom right of every
 * project page and the panel it opens. The chat lives here, so closing the panel keeps it (and the
 * session) for the page's life; the stream is open only while the panel is.
 */
export function AssistantDock({
  projectId,
  projectName,
  eventSource,
}: {
  projectId: string;
  projectName: string;
  eventSource: EventSourceFactory | null;
}) {
  const [open, setOpen] = useState(false);
  const chat = useAssistant({ projectId, open, eventSource });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  return (
    <>
      {open ? <AssistantPanel projectName={projectName} chat={chat} onClose={close} /> : null}
      <button
        ref={buttonRef}
        type="button"
        aria-label={open ? C.close : C.open}
        aria-expanded={open}
        title={open ? C.close : C.open}
        data-testid="assistant-button"
        onClick={() => (open ? close() : setOpen(true))}
        className={`fixed right-4 bottom-4 z-40 size-12 items-center justify-center rounded-full border border-accent-fill-edge bg-accent-fill text-accent-fill-ink shadow-pop transition-transform duration-150 hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none sm:right-6 sm:bottom-6 ${
          // The bottom sheet covers the button on narrow screens; its header has the close button.
          open ? 'hidden sm:inline-flex' : 'inline-flex'
        }`}
      >
        {open ? <CloseIcon size={20} /> : <AssistantIcon size={22} />}
      </button>
    </>
  );
}
