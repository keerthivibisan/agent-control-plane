import { AGENT_EFFORTS, MANAGED_PROVIDERS, type ManagedProviderId } from '@acp/core';
import { MAX_ASSISTANT_MESSAGE, type AssistantMode } from '@acp/core/api';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/Button';
import { AssistantIcon, CloseIcon, SendIcon } from '../../components/icons';
import { fieldClass } from '../../components/Input';
import { Pill } from '../../components/Pill';
import { ASSISTANT_COPY, PROVIDER_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { MODEL_SUGGESTIONS } from '../../lib/providers';
import { MarkdownPreview } from '../skills/markdown';
import { ProposalCard } from './ProposalCard';
import { defaultModel, live, type AssistantChat, type AssistantPickers } from './use-assistant';

const C = ASSISTANT_COPY;
const MODES: readonly AssistantMode[] = ['approve', 'auto'];

const pickerClass = `${fieldClass} h-8 min-h-8 w-full px-2 py-0 text-caption`;

/** Budget tokens used of the session's soft cap, as a thin bar with the numbers beside it. */
function BudgetMeter({ used, limit }: { used: number; limit: number }) {
  const pct = limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const text = C.budget(formatCount(used, 'compact'), formatCount(limit, 'compact'));
  return (
    <div className="flex min-w-0 items-center gap-1.5" data-testid="assistant-budget">
      <div
        role="meter"
        aria-label={C.budgetLabel}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-valuetext={text}
        className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-hover"
      >
        <div
          className={`h-full rounded-full ${pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="truncate text-micro text-dim tabular-nums">{text}</span>
    </div>
  );
}

/**
 * The project assistant's panel (ADR-0035): a non-modal dialog at the bottom right (a full-width
 * bottom sheet on narrow screens). The header holds the provider, model, effort and mode; the chat
 * shows the owner's messages, the assistant's text, muted activity lines and proposal cards.
 */
export function AssistantPanel({
  projectName,
  chat,
  onClose,
}: {
  projectName: string;
  chat: AssistantChat;
  onClose: () => void;
}) {
  const id = useId();
  const { session, pickers } = chat;
  const [input, setInput] = useState('');
  const [pendingChange, setPendingChange] = useState<AssistantPickers | null>(null);
  const [modelDraft, setModelDraft] = useState(pickers.model);
  const [seenModel, setSeenModel] = useState(pickers.model);
  if (pickers.model !== seenModel) {
    setSeenModel(pickers.model);
    setModelDraft(pickers.model);
  }
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // New lines scroll into view.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.items.length, session?.status]);

  const running = live(session);
  const mode = session?.mode ?? pickers.mode;
  const closed = (session !== null && !running) || chat.items.some((i) => i.kind === 'ended');
  const working = session?.status === 'working' || chat.sending;

  /** Provider, model or effort: confirm first while a chat runs, since it starts a new one. */
  const change = (next: AssistantPickers) => {
    if (running) setPendingChange(next);
    else chat.setPickers(next);
  };

  const commitModel = () => {
    const model = modelDraft.trim();
    if (model === pickers.model) return;
    change({ ...pickers, model });
  };

  const cancelChange = () => {
    setPendingChange(null);
    setModelDraft(pickers.model);
  };

  const send = async (text: string) => {
    if (text.trim() === '' || chat.sending) return;
    setInput('');
    await chat.send(text);
    inputRef.current?.focus();
  };

  const onPanelKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  /** An example prompt goes into the input for the owner to edit; it is never sent from here. */
  const suggestion = (s: (typeof C.suggestions)[number]) => {
    setInput(s.prompt);
    const el = inputRef.current;
    if (el) {
      el.focus();
      // After React writes the value: the caret at the end, ready to type.
      requestAnimationFrame(() => el.setSelectionRange(s.prompt.length, s.prompt.length));
    }
  };

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label={C.dialog(projectName)}
      onKeyDown={onPanelKey}
      data-testid="assistant-panel"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col overflow-hidden rounded-t-overlay border border-line bg-panel text-ink shadow-pop sm:inset-x-auto sm:right-6 sm:bottom-22 sm:h-[min(720px,calc(100dvh-var(--spacing-topbar)-7rem))] sm:w-[460px] sm:rounded-overlay"
    >
      <header className="flex flex-col gap-2 border-b border-line bg-subtle px-3 py-2.5">
        <div className="flex items-center gap-2">
          <AssistantIcon size={18} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-body leading-tight font-semibold">{C.title}</h2>
            <p className="truncate text-micro text-dim">{projectName}</p>
          </div>
          <Pill
            tone={mode === 'auto' ? 'warning' : 'neutral'}
            testId="assistant-mode-badge"
            title={C.modeTips[mode]}
          >
            {C.modes[mode]}
          </Pill>
          <Button variant="quiet" size="sm" aria-label={C.close} onClick={onClose}>
            <CloseIcon size={16} />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="text-micro text-dim">{C.provider}</span>
            <select
              className={pickerClass}
              value={pickers.provider}
              disabled={chat.busy}
              onChange={(e) => {
                const provider = e.target.value as ManagedProviderId;
                change({ ...pickers, provider, model: defaultModel(provider) });
              }}
            >
              {MANAGED_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_COPY.name[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="text-micro text-dim">{C.model}</span>
            <input
              className={`${pickerClass} font-mono`}
              value={modelDraft}
              placeholder={C.modelDefault}
              list={`${id}-models`}
              maxLength={100}
              disabled={chat.busy}
              onChange={(e) => setModelDraft(e.target.value)}
              onBlur={commitModel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitModel();
                }
              }}
            />
            <datalist
              id={`${id}-models`}
              aria-label={PROVIDER_COPY.suggestions(PROVIDER_COPY.name[pickers.provider])}
            >
              {MODEL_SUGGESTIONS[pickers.provider].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="text-micro text-dim">{C.effort}</span>
            <select
              className={pickerClass}
              value={pickers.effort}
              disabled={chat.busy}
              onChange={(e) =>
                change({ ...pickers, effort: e.target.value as AssistantPickers['effort'] })
              }
            >
              {AGENT_EFFORTS.map((x) => (
                <option key={x} value={x}>
                  {C.efforts[x]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="text-micro text-dim">{C.modeLabel}</span>
            <select
              className={pickerClass}
              value={mode}
              disabled={chat.busy}
              title={C.modeTips[mode]}
              onChange={(e) => void chat.changeMode(e.target.value as AssistantMode)}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {C.modes[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          {session !== null ? (
            <BudgetMeter used={session.budget.used} limit={session.budget.limit} />
          ) : null}
          <div className="ml-auto flex gap-1">
            <Button
              variant="quiet"
              size="sm"
              disabled={chat.busy || (session === null && chat.items.length === 0)}
              onClick={() => void chat.newChat()}
            >
              {C.newChat}
            </Button>
            <Button
              variant="quiet"
              size="sm"
              disabled={chat.busy || !running}
              onClick={() => void chat.end()}
            >
              {C.end}
            </Button>
          </div>
        </div>
        {pendingChange !== null ? (
          <div
            role="alertdialog"
            aria-label={C.restart.question}
            className="flex flex-col gap-2 rounded-control border border-warning/50 bg-warning-soft p-2"
            data-testid="assistant-restart"
          >
            <p className="text-caption">
              <span className="font-semibold">{C.restart.question}</span> {C.restart.text}
            </p>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const next = pendingChange;
                  setPendingChange(null);
                  void chat.restart(next);
                }}
              >
                {C.restart.confirm}
              </Button>
              <Button size="sm" onClick={cancelChange}>
                {C.restart.cancel}
              </Button>
            </div>
          </div>
        ) : null}
      </header>

      <div
        ref={logRef}
        role="log"
        aria-label={C.messages}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {chat.items.length === 0 && session?.status !== 'working' ? (
          <div className="flex flex-col gap-3 py-2" data-testid="assistant-empty">
            <p className="text-body leading-relaxed text-dim">{C.empty}</p>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-micro font-semibold tracking-wide text-dim uppercase">
                {C.suggestionsLabel}
              </h3>
              <ul aria-label={C.suggestionsLabel} className="flex flex-col gap-1.5">
                {C.suggestions.map((s) => (
                  <li key={s.label}>
                    <button
                      type="button"
                      className="flex w-full flex-col gap-0.5 rounded-control border border-line bg-control px-3 py-2 text-left transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-50"
                      disabled={chat.sending || closed}
                      onClick={() => suggestion(s)}
                    >
                      <span className="text-caption font-semibold text-ink">{s.label}</span>
                      <span className="line-clamp-2 text-caption text-dim">
                        {s.prompt.split('\n')[0]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-micro text-dim">{C.suggestionsHint}</p>
            </div>
          </div>
        ) : null}
        {chat.items.map((item) => {
          switch (item.kind) {
            case 'owner':
              return (
                <div
                  key={item.key}
                  className="max-w-[85%] self-end rounded-card rounded-br-sm bg-accent-soft px-3.5 py-2 text-body leading-relaxed whitespace-pre-wrap break-words text-ink"
                  data-testid="assistant-owner"
                >
                  <span className="sr-only">{C.you}: </span>
                  {item.text}
                </div>
              );
            case 'assistant':
              return (
                <div
                  key={item.key}
                  className="w-full self-start rounded-card rounded-bl-sm border border-line bg-subtle px-3.5 py-2.5 text-body break-words text-ink"
                  data-testid="assistant-text"
                >
                  <span className="sr-only">{C.assistant}: </span>
                  {/* Model text as React elements only (no HTML), links shown as text. */}
                  <MarkdownPreview source={item.text} empty="" compact />
                </div>
              );
            case 'activity':
              return (
                <p
                  key={item.key}
                  className="flex items-center gap-1.5 self-start pl-1 text-micro text-dim before:size-1 before:rounded-full before:bg-line-strong before:content-['']"
                  data-testid="assistant-activity"
                >
                  {item.text}
                </p>
              );
            case 'proposal': {
              const proposal = chat.proposals[item.id];
              return proposal ? (
                <ProposalCard
                  key={item.key}
                  proposal={proposal}
                  onDecide={(d) => chat.decide(proposal.id, d)}
                />
              ) : null;
            }
            case 'error':
              return (
                <div
                  key={item.key}
                  role="alert"
                  className="rounded-control border border-danger/50 bg-danger-soft px-3 py-2 text-caption text-danger"
                  data-testid="assistant-error"
                >
                  <p>{item.text}</p>
                  {item.hint !== null ? <p className="mt-1 text-ink">{item.hint}</p> : null}
                </div>
              );
            case 'ended':
              return null;
          }
        })}
        {working ? (
          <p
            className="flex items-center gap-2 self-start text-caption text-dim"
            data-testid="assistant-working"
          >
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-accent" />
            {C.working}
          </p>
        ) : null}
      </div>

      <footer className="border-t border-line bg-panel px-3 py-2.5">
        {closed ? (
          <div className="flex flex-col gap-2" data-testid="assistant-ended">
            <p className="text-caption text-dim">
              {session?.status === 'failed' && session.failure !== null
                ? C.failed(session.failure)
                : (chat.items.find((i) => i.kind === 'ended')?.text ?? C.ended)}
            </p>
            <Button
              variant="primary"
              size="sm"
              className="self-start"
              disabled={chat.busy}
              onClick={() => void chat.newChat()}
            >
              {C.startNew}
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              aria-label={C.input}
              placeholder={C.placeholder}
              rows={3}
              maxLength={MAX_ASSISTANT_MESSAGE}
              value={input}
              disabled={chat.sending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKey}
              className={`${fieldClass} max-h-48 min-h-16 flex-1 resize-none text-body leading-relaxed`}
            />
            <Button
              variant="primary"
              aria-label={C.send}
              disabled={chat.sending || input.trim() === ''}
              onClick={() => void send(input)}
            >
              <SendIcon size={16} />
            </Button>
          </div>
        )}
      </footer>
    </section>
  );
}
