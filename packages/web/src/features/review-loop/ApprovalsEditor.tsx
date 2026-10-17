import {
  APPROVAL_MODES,
  MAX_COMMAND_PATTERNS,
  type ApprovalMode,
  type CommandPattern,
} from '@acp/core';
import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { AlertIcon } from '../../components/icons';
import { Badge } from '../../components/Pill';
import { hintClass, inputClass, labelClass } from '../../components/Input';
import { REVIEW_LOOP_COPY } from '../../lib/copy';
import { ChoiceCards } from '../project-setup/fields';
import { CommandIcon, RemoveCommandIcon } from './icons';
import { checkCommand, commandText } from './logic';

const A = REVIEW_LOOP_COPY.approvals;
const M = REVIEW_LOOP_COPY.modes;

/** The three modes as native radios, each with the sentence of what runs without asking. */
export function ApprovalModeChoice({
  value,
  onChange,
  columns = 1,
}: {
  value: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
  columns?: 1 | 3;
}) {
  const name = useId();
  return (
    <ChoiceCards<ApprovalMode>
      legend={A.legend}
      name={`${name}-mode`}
      value={value}
      columns={columns}
      options={APPROVAL_MODES.map((m) => ({ value: m, label: M.label[m], hint: M.hint[m] }))}
      onChange={onChange}
    />
  );
}

/**
 * The plain warning under Auto edits and Auto (ADR-0021 safety): a harness check or an allowed
 * command runs code the agents wrote, with the owner's permissions.
 */
export function AutoRunWarning() {
  return (
    <div
      className="flex items-start gap-2 rounded-control border border-warning/25 bg-warning-soft px-3 py-2.5 text-caption"
      data-testid="approvals-warning"
    >
      <AlertIcon size={14} className="mt-px shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium text-warning">{A.warningTitle}</p>
        <p className="text-ink">{A.warning}</p>
      </div>
    </div>
  );
}

/**
 * Auto mode's command allowlist: the listed patterns with Remove, and a field to add one. Each
 * new entry is checked with core's `CommandPatternSchema` as it is added, so a refusal (a
 * metacharacter, an absolute path, a forbidden command, `git` that writes) shows inline.
 */
export function CommandListEditor({
  commands,
  active,
  onChange,
}: {
  commands: readonly CommandPattern[];
  /** Auto mode: the list is in use. Otherwise it is kept, and says so. */
  active: boolean;
  onChange: (commands: CommandPattern[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [match, setMatch] = useState<CommandPattern['match']>('exact');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const r = checkCommand(text, match, commands);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setText('');
    onChange([...commands, r.pattern]);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="command-list">
      <div className="flex flex-col gap-0.5">
        <h5 className="flex items-center gap-1.5 font-medium">
          <CommandIcon size={14} className="shrink-0 text-dim" />
          {A.commandsTitle}
        </h5>
        <p className={hintClass}>
          {active ? A.commandsNote(MAX_COMMAND_PATTERNS) : A.commandsKept}
        </p>
      </div>
      {commands.length === 0 ? (
        <p className="rounded-control border border-dashed border-line-strong px-3 py-2.5 text-caption text-dim">
          {A.commandsEmpty}
        </p>
      ) : (
        <ul
          aria-label={A.listLabel}
          className="flex flex-col divide-y divide-line overflow-hidden rounded-control border border-line"
        >
          {commands.map((p) => {
            const cmd = commandText(p);
            return (
              <li
                key={`${p.match} ${cmd}`}
                className="flex items-center gap-2 bg-panel py-1.5 pr-1.5 pl-3"
                data-testid="command-row"
              >
                <code className="min-w-0 flex-1 truncate font-mono text-caption" title={cmd}>
                  {cmd}
                </code>
                <Badge tone={p.match === 'prefix' ? 'accent' : 'neutral'}>
                  {A.matchTag[p.match]}
                </Badge>
                <button
                  type="button"
                  aria-label={A.remove(cmd)}
                  title={A.remove(cmd)}
                  onClick={() => onChange(commands.filter((c) => c !== p))}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-dim transition-colors hover:bg-hover hover:text-danger"
                >
                  <RemoveCommandIcon size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col gap-2 rounded-control border border-line bg-sunken/60 p-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-cmd`} className={labelClass}>
            {A.commandLabel}
          </label>
          <input
            id={`${id}-cmd`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error !== null) setError(null);
            }}
            onKeyDown={(e) => {
              // Enter adds, as in a form; the panel itself is not a form.
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder={A.commandPlaceholder}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={error !== null ? true : undefined}
            aria-describedby={error !== null ? `${id}-hint ${id}-error` : `${id}-hint`}
            className={inputClass('font-mono')}
          />
          <span id={`${id}-hint`} className={hintClass}>
            {A.commandHint}
          </span>
          {error !== null ? (
            <span
              id={`${id}-error`}
              role="alert"
              className="text-caption font-medium text-danger"
              data-testid="command-error"
            >
              {error}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1.5">
            <label htmlFor={`${id}-match`} className={labelClass}>
              {A.matchLabel}
            </label>
            <select
              id={`${id}-match`}
              value={match}
              onChange={(e) => setMatch(e.target.value === 'prefix' ? 'prefix' : 'exact')}
              className={inputClass('pr-8')}
            >
              <option value="exact">{A.match.exact}</option>
              <option value="prefix">{A.match.prefix}</option>
            </select>
          </div>
          <Button onClick={add}>{A.add}</Button>
        </div>
      </div>
    </div>
  );
}
