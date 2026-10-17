import { HARD_MAX_HELPERS, MAX_CONTEXT_FILES } from '@acp/core';
import type { ContextCandidateDto, HarnessStatusDto } from '@acp/core/api';
import { useId } from 'react';
import { CONTROL_COPY, PROJECT_SETUP_COPY, formatKiB } from '../../lib/copy';
import type { QueryState } from '../../lib/query-store';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Badge } from '../../components/Pill';
import { LoadingBlock } from '../../components/Skeleton';
import { CheckboxField, ChoiceCards, FixedSetting, NumberChoice, TextField } from './fields';
import {
  DEPTH_CHOICES,
  HELPER_CHOICES,
  MAX_CONTEXT_KIB,
  contextUsage,
  parseTokens,
  type Depth,
  type SetupDraft,
  type SetupErrors,
} from './setup-form';

/**
 * The three editable parts of a project's AI work environment, shared by the wizard (steps 2–4)
 * and the settings page. Each takes the draft and reports changes; validation lives in setup-form.
 */

export interface SectionProps {
  draft: SetupDraft;
  errors: SetupErrors;
  onChange: (patch: Partial<SetupDraft>) => void;
}

const A = PROJECT_SETUP_COPY.agents;

/** Wizard step 2: plan first, helpers at once, depth, budget, model, ticket prefix. */
export function AgentFields({ draft, errors, onChange }: SectionProps) {
  const name = useId();
  const tokens = parseTokens(draft.budget);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <FixedSetting label={A.planFirst} value={A.planFirstValue} hint={A.planFirstHint} />
        <TextField
          label={A.projectKey}
          hint={A.projectKeyHint}
          error={errors.projectKey}
          value={draft.projectKey}
          onChange={(v) => onChange({ projectKey: v.toUpperCase() })}
          placeholder="WEB"
          mono
          inputClassName="max-w-32 uppercase"
        />
      </div>
      <NumberChoice
        legend={A.helpers}
        hint={A.helpersHint(HARD_MAX_HELPERS)}
        name={`${name}-helpers`}
        value={draft.maxConcurrentHelpers}
        choices={HELPER_CHOICES}
        onChange={(n) => onChange({ maxConcurrentHelpers: n })}
        valueText={A.helpersValue}
      />
      <ChoiceCards<Depth>
        legend={A.depth}
        name={`${name}-depth`}
        value={draft.maxDepth}
        options={DEPTH_CHOICES.map((d) => ({ value: d, ...A.depthOptions[d] }))}
        onChange={(d) => onChange({ maxDepth: d })}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label={A.budget}
          tip={CONTROL_COPY.terms.budget.tip}
          hint={tokens === null ? A.budgetHint : `${A.budgetValue(tokens)}. ${A.budgetHint}`}
          error={errors.budget}
          value={draft.budget}
          onChange={(v) => onChange({ budget: v })}
          numeric
          inputClassName="max-w-48"
        />
        <TextField
          label={A.model}
          hint={A.modelHint}
          error={errors.model}
          value={draft.model}
          onChange={(v) => onChange({ model: v })}
          placeholder={A.modelPlaceholder}
          mono
        />
      </div>
    </div>
  );
}

const L = PROJECT_SETUP_COPY.allowlist;

/** Wizard step 3: the two pre-approved actions (ADR-0013 amendment). */
export function AllowlistFields({
  draft,
  onChange,
  harness,
}: Omit<SectionProps, 'errors'> & { harness: HarnessStatusDto | undefined }) {
  const noHarness =
    harness !== undefined && (harness.state === 'none' || harness.state === 'invalid');
  return (
    <div className="flex flex-col gap-3">
      <CheckboxField
        label={L.edit}
        hint={L.editHint}
        checked={draft.editInOwnWorktree}
        onChange={(v) => onChange({ editInOwnWorktree: v })}
      />
      <CheckboxField
        label={L.checks}
        hint={L.checksHint}
        checked={draft.runHarnessChecks}
        onChange={(v) => onChange({ runHarnessChecks: v })}
        note={noHarness && draft.runHarnessChecks ? L.checksNoHarness : undefined}
      />
      <p className="text-caption text-dim">{L.recorded}</p>
    </div>
  );
}

const X = PROJECT_SETUP_COPY.context;

interface Row {
  path: string;
  sizeBytes: number | null;
  suggested: boolean;
  listed: boolean;
}

function rows(chosen: readonly string[], candidates: readonly ContextCandidateDto[]): Row[] {
  const listed = new Set(candidates.map((c) => c.path));
  // Files already chosen but no longer offered stay visible, so they can be removed.
  const missing = chosen
    .filter((p) => !listed.has(p))
    .map((p) => ({ path: p, sizeBytes: null, suggested: false, listed: false }));
  return [
    ...candidates.map((c) => ({
      path: c.path,
      sizeBytes: c.sizeBytes,
      suggested: c.suggested,
      listed: true,
    })),
    ...missing,
  ];
}

/** Wizard step 4: pick the files every agent reads first; the limits are counted as you pick. */
export function ContextPicker({
  draft,
  errors,
  onChange,
  candidates,
}: SectionProps & { candidates: QueryState<ContextCandidateDto[]> }) {
  const chosen = new Set(draft.contextFiles);
  const usage = contextUsage(draft.contextFiles, candidates.data);
  const toggle = (path: string, on: boolean) =>
    onChange({
      contextFiles: on
        ? [...draft.contextFiles, path]
        : draft.contextFiles.filter((p) => p !== path),
    });

  if (candidates.data === undefined) {
    if (candidates.error) return <ErrorNotice error={candidates.error} />;
    return <LoadingBlock label={X.loading} />;
  }
  const list = rows(draft.contextFiles, candidates.data);
  const overFiles = draft.contextFiles.length > MAX_CONTEXT_FILES;
  const overSize = usage.bytes > MAX_CONTEXT_KIB * 1024;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption"
        aria-live="polite"
        data-testid="context-usage"
      >
        <span className={overFiles ? 'font-medium text-danger' : 'text-dim'}>
          {X.selected(draft.contextFiles.length, MAX_CONTEXT_FILES)}
        </span>
        <span className={overSize ? 'font-medium text-danger' : 'text-dim'}>
          {X.size(formatKiB(usage.bytes), MAX_CONTEXT_KIB)}
        </span>
        <span className="text-dim">{X.limits(MAX_CONTEXT_FILES, MAX_CONTEXT_KIB)}</span>
      </div>
      {list.length === 0 ? (
        <p className="rounded-control border border-dashed border-line-strong bg-sunken/40 px-3 py-6 text-center text-dim">
          {X.none}
        </p>
      ) : (
        <ul
          aria-label={X.listLabel}
          className="flex max-h-80 flex-col divide-y divide-line overflow-y-auto rounded-control border border-line-strong"
        >
          {list.map((r) => (
            <li key={r.path}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-hover has-checked:bg-accent-soft/40">
                <input
                  type="checkbox"
                  checked={chosen.has(r.path)}
                  onChange={(e) => toggle(r.path, e.target.checked)}
                  aria-label={r.path}
                  className="size-4 shrink-0 accent-accent"
                />
                <span className="min-w-0 flex-1 truncate font-mono text-caption" title={r.path}>
                  {r.path}
                </span>
                {r.suggested ? <Badge tone="accent">{X.suggested}</Badge> : null}
                <span className="shrink-0 text-caption text-dim tabular-nums">
                  {r.listed ? formatKiB(r.sizeBytes ?? 0) : X.notListed}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {errors.contextFiles ? (
        <p role="alert" className="text-caption text-danger" data-field-error>
          {errors.contextFiles}
        </p>
      ) : null}
    </div>
  );
}
