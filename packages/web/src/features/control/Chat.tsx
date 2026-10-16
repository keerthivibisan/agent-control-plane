import type { ChatMessageDto } from '@acp/core/api';
import { Fragment, useEffect, useId, useRef, type KeyboardEvent, type RefObject } from 'react';
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

/**
 * Who a bubble names; the ticket page tells the planner from the lead (redesign decision C), and
 * tags a follow-up turn's messages (ADR-0020).
 */
export type SpeakerOf = (m: ChatMessageDto) => {
  label: string;
  tip?: string;
  tag?: { label: string; tip?: string };
};

function Bubble({ m, speakerOf }: { m: ChatMessageDto; speakerOf: SpeakerOf | undefined }) {
  const owner = m.role === 'owner';
  const speaker = speakerOf?.(m) ?? { label: owner ? C.you : C.lead };
  return (
    <li
      className={`flex flex-col gap-1 ${owner ? 'items-end' : 'items-start'}`}
      data-testid="chat-message"
      data-role={m.role}
      data-follow-up={m.followUp === true ? 'true' : undefined}
    >
      <span className="flex items-center gap-2 text-caption text-dim">
        <span className="font-medium" title={speaker.tip} data-testid="chat-speaker">
          {speaker.label}
        </span>
        {speaker.tag ? (
          <span
            className="rounded-full border border-line px-1.5 text-[0.6875rem] leading-4 font-medium"
            title={speaker.tag.tip}
            data-testid="chat-tag"
          >
            {speaker.tag.label}
          </span>
        ) : null}
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
  speakerOf,
  closedText,
  notice,
  waiting,
  placeholder,
  followUpDivider,
  who,
}: {
  runId: string;
  messages: readonly ChatMessageDto[];
  /** False once the run has ended: the history stays, the box goes. */
  open: boolean;
  draft: string;
  onDraft: (text: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** The bubble's name; by default "You" or the lead agent. */
  speakerOf?: SpeakerOf;
  /** Why the box is gone, when it is not that the run ended. */
  closedText?: string;
  /** A short line above the box, e.g. what a message to an ended lead does (ADR-0020). */
  notice?: string;
  /** Set while the agent answers: the box stays but is disabled, with this line above it. */
  waiting?: string;
  placeholder?: string;
  /** A divider with this text before the first follow-up message (`followUp: true`). */
  followUpDivider?: string;
  /**
   * Who the box reaches, for the title, label and placeholder ("the planner agent"); by default
   * the lead agent.
   */
  who?: string;
}) {
  const words = who === undefined ? C : C.withAgent(who);
  const send = useControlAction(sendChat);
  const listRef = useRef<HTMLOListElement>(null);
  const inputId = useId();
  const hintId = useId();
  const noticeId = useId();
  const sorted = [...messages].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const firstFollowUp =
    followUpDivider === undefined ? undefined : sorted.find((m) => m.followUp === true)?.id;
  const tooLong = draft.length > MAX_CHARS;
  const busy = waiting !== undefined;
  const line = waiting ?? notice;

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sorted.length]);

  const submit = async () => {
    const text = draft.trim();
    if (text.length === 0 || tooLong || send.pending || busy) return;
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
    <Card title={words.title} testId="chat">
      {sorted.length === 0 ? (
        <EmptyState compact title={C.empty.title} text={words.empty.text} />
      ) : (
        <ol
          ref={listRef}
          aria-label={words.title}
          className="-mx-1 flex max-h-[62vh] flex-col gap-4 overflow-y-auto px-1 pb-1"
        >
          {sorted.map((m) => (
            <Fragment key={m.id}>
              {m.id === firstFollowUp ? (
                <li
                  className="flex items-center gap-3 text-caption text-dim"
                  data-testid="chat-divider"
                >
                  <span aria-hidden="true" className="h-px flex-1 bg-line" />
                  {followUpDivider}
                  <span aria-hidden="true" className="h-px flex-1 bg-line" />
                </li>
              ) : null}
              <Bubble m={m} speakerOf={speakerOf} />
            </Fragment>
          ))}
        </ol>
      )}
      {open ? (
        <form
          className="mt-4 flex flex-col gap-2 border-t border-line pt-4"
          data-testid="chat-form"
          data-waiting={busy ? 'true' : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {line !== undefined ? (
            <p
              id={noticeId}
              role={busy ? 'status' : undefined}
              className="flex items-start gap-2 text-caption text-dim"
              data-testid="chat-notice"
            >
              {busy ? (
                <span
                  aria-hidden="true"
                  className="mt-1.5 inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-accent"
                />
              ) : null}
              <span>{line}</span>
            </p>
          ) : null}
          <label htmlFor={inputId} className="sr-only">
            {words.label}
          </label>
          <textarea
            id={inputId}
            ref={inputRef}
            rows={3}
            value={draft}
            disabled={busy}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? words.placeholder}
            aria-describedby={line !== undefined ? `${noticeId} ${hintId}` : hintId}
            aria-invalid={tooLong ? true : undefined}
            className={`resize-y rounded-control border bg-panel px-3 py-2 text-ink placeholder:text-dim/70 disabled:cursor-not-allowed disabled:opacity-60 ${
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
              disabled={busy || send.pending || tooLong || draft.trim().length === 0}
            >
              {send.pending ? C.sending : C.send}
            </Button>
          </div>
          <ActionError error={send.error} message={C.failed} />
        </form>
      ) : (
        <p className="mt-4 border-t border-line pt-4 text-dim">{closedText ?? C.closed}</p>
      )}
    </Card>
  );
}
