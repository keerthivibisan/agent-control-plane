import type { ChatMessageDto } from '@acp/core/api';
import { useEffect, useId, useRef, type KeyboardEvent, type RefObject } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { RelativeTime } from '../../components/RelativeTime';
import { sendChat } from '../../lib/api';
import { CONTROL_COPY } from '../../lib/copy';
import { useControlAction } from './actions';
import { ActionError } from './bits';

const C = CONTROL_COPY.chat;
const MAX_CHARS = 8000;

function Bubble({ m }: { m: ChatMessageDto }) {
  const owner = m.role === 'owner';
  return (
    <li
      className={`flex flex-col gap-1 ${owner ? 'items-end' : 'items-start'}`}
      data-testid="chat-message"
      data-role={m.role}
    >
      <span className="flex items-center gap-2 text-caption text-dim">
        <span className="font-medium">{owner ? C.you : C.lead}</span>
        <RelativeTime iso={m.createdAt} />
      </span>
      <p
        className={`max-w-[85%] rounded-card px-3.5 py-2.5 break-words whitespace-pre-wrap ${
          owner
            ? 'rounded-tr-sm bg-accent-soft text-ink'
            : 'rounded-tl-sm border border-line bg-sunken text-ink'
        }`}
      >
        {m.text}
      </p>
    </li>
  );
}

/**
 * The owner ↔ lead conversation (stored locally, ADR-0015) and the box to write to the lead.
 * The draft lives in the parent so an agent card's Message button can prefill it.
 */
export function Chat({
  runId,
  messages,
  open,
  draft,
  onDraft,
  inputRef,
}: {
  runId: string;
  messages: readonly ChatMessageDto[];
  /** False once the run has ended: the history stays, the box goes. */
  open: boolean;
  draft: string;
  onDraft: (text: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const send = useControlAction(sendChat);
  const listRef = useRef<HTMLOListElement>(null);
  const inputId = useId();
  const hintId = useId();
  const sorted = [...messages].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const tooLong = draft.length > MAX_CHARS;

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sorted.length]);

  const submit = async () => {
    const text = draft.trim();
    if (text.length === 0 || tooLong || send.pending) return;
    const sent = await send.run(runId, { text });
    if (sent !== null) onDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Card title={C.title} testId="chat">
      {sorted.length === 0 ? (
        <EmptyState compact title={C.empty.title} text={C.empty.text} />
      ) : (
        <ol
          ref={listRef}
          aria-label={C.title}
          className="-mx-1 flex max-h-[62vh] flex-col gap-4 overflow-y-auto px-1 pb-1"
        >
          {sorted.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
        </ol>
      )}
      {open ? (
        <form
          className="mt-4 flex flex-col gap-2 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {C.label}
          </label>
          <textarea
            id={inputId}
            ref={inputRef}
            rows={3}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={C.placeholder}
            aria-describedby={hintId}
            aria-invalid={tooLong ? true : undefined}
            className={`resize-y rounded-control border bg-panel px-3 py-2 text-ink placeholder:text-dim/70 ${
              tooLong ? 'border-danger' : 'border-line-strong'
            }`}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span id={hintId} className="flex-1 text-caption text-dim">
              {tooLong ? <span className="text-danger">{C.tooLong(MAX_CHARS)}</span> : C.hint}
            </span>
            <Button
              type="submit"
              variant="primary"
              disabled={send.pending || tooLong || draft.trim().length === 0}
            >
              {send.pending ? C.sending : C.send}
            </Button>
          </div>
          <ActionError error={send.error} message={C.failed} />
        </form>
      ) : (
        <p className="mt-4 border-t border-line pt-4 text-dim">{C.closed}</p>
      )}
    </Card>
  );
}
