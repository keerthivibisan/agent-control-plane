import { automationOf, automationWarnings, type ProjectAutomation } from '@acp/core';
import type { ProjectAgentSetupDto } from '@acp/core/api';
import { useId, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { AlertIcon } from '../../components/icons';
import { Select, TextArea, TextInput, hintClass, labelClass } from '../../components/Input';
import { isProjectSetupPath, updateProjectSetup } from '../../lib/api';
import { AUTOMATION_COPY } from '../../lib/copy';
import { ActionError } from '../control/bits';
import { useSetupAction } from './actions';
import {
  automationRequest,
  draftFromPolicy,
  toPolicy,
  type AutomationDraft,
} from './automation-form';

const A = AUTOMATION_COPY;

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/**
 * ADR-0030: the project's conflict resolution, verification and delivery policy. Three separate
 * parts, each conservative by default; the owner widens them explicitly. Saved through the setup
 * PUT's `automation` (nothing else changes).
 */
export function AutomationCard({
  projectId,
  setup,
}: {
  projectId: string;
  setup: ProjectAgentSetupDto;
}) {
  const stored = automationOf(setup);
  const [draft, setDraft] = useState<AutomationDraft>(() => draftFromPolicy(stored));
  const invalidate = useMemo(() => isProjectSetupPath(projectId), [projectId]);
  const save = useSetupAction(updateProjectSetup, invalidate);
  const policy: ProjectAutomation | null = toPolicy(draft, stored);
  const warnings = policy === null ? [] : automationWarnings(policy);
  const set = <K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const submit = (automation: ProjectAutomation | null) => {
    const body = automationRequest(setup, automation);
    if (body !== null) void save.run(projectId, body);
  };
  return (
    <Card title={A.title} description={A.description} testId="settings-automation">
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (policy !== null) submit(policy);
        }}
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="pb-1 font-medium">{A.conflict.label}</legend>
          <Field label={A.conflict.label}>
            {(id) => (
              <Select
                id={id}
                value={draft.conflictMode}
                onChange={(e) =>
                  set('conflictMode', e.target.value as AutomationDraft['conflictMode'])
                }
                data-testid="automation-conflict-mode"
              >
                <option value="manual">{A.conflict.manual}</option>
                <option value="auto">{A.conflict.auto}</option>
              </Select>
            )}
          </Field>
          <Field label={A.conflict.attempts}>
            {(id) => (
              <Select
                id={id}
                value={String(draft.maxAttempts)}
                onChange={(e) => set('maxAttempts', Number(e.target.value))}
              >
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="pb-1 font-medium">{A.verification.label}</legend>
          <Field label={A.verification.label}>
            {(id) => (
              <Select
                id={id}
                value={draft.verificationMode}
                onChange={(e) =>
                  set('verificationMode', e.target.value as AutomationDraft['verificationMode'])
                }
                data-testid="automation-verification-mode"
              >
                <option value="required">{A.verification.required}</option>
                <option value="agent-adaptive">{A.verification.adaptive}</option>
              </Select>
            )}
          </Field>
          {draft.verificationMode === 'agent-adaptive' ? (
            <Field label={A.verification.skipScopes}>
              {(id) => (
                <TextArea
                  id={id}
                  rows={3}
                  value={draft.skipScopes}
                  onChange={(e) => set('skipScopes', e.target.value)}
                  data-testid="automation-skip-scopes"
                />
              )}
            </Field>
          ) : null}
          <Field label={A.verification.alwaysRun}>
            {(id) => (
              <TextInput
                id={id}
                value={draft.alwaysRun}
                onChange={(e) => set('alwaysRun', e.target.value)}
              />
            )}
          </Field>
          <Field label={A.verification.missing}>
            {(id) => (
              <Select
                id={id}
                value={draft.onMissing}
                onChange={(e) => set('onMissing', e.target.value as AutomationDraft['onMissing'])}
              >
                <option value="escalate">{A.verification.escalate}</option>
                <option value="draft-pr">{A.verification.draft}</option>
              </Select>
            )}
          </Field>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={draft.allowUnverified}
              onChange={(e) => set('allowUnverified', e.target.checked)}
              data-testid="automation-allow-unverified"
            />
            <span>{A.verification.unverified}</span>
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="pb-1 font-medium">{A.delivery.label}</legend>
          <Field label={A.delivery.label}>
            {(id) => (
              <Select
                id={id}
                value={draft.deliveryMode}
                onChange={(e) =>
                  set('deliveryMode', e.target.value as AutomationDraft['deliveryMode'])
                }
                data-testid="automation-delivery-mode"
              >
                <option value="manual">{A.delivery.manual}</option>
                <option value="push-pr">{A.delivery.pushPr}</option>
                <option value="merge">{A.delivery.merge}</option>
              </Select>
            )}
          </Field>
          {draft.deliveryMode !== 'manual' ? (
            <Field label={A.delivery.targets}>
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.targets}
                  onChange={(e) => set('targets', e.target.value)}
                  data-testid="automation-targets"
                />
              )}
            </Field>
          ) : null}
        </fieldset>
        {policy === null ? (
          <p role="alert" className={`${hintClass} text-danger`} data-testid="automation-invalid">
            {A.invalid}
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="flex flex-col gap-1" data-testid="automation-warnings">
            {warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-caption">
                <AlertIcon size={14} className="mt-0.5 shrink-0 text-warning" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={policy === null || save.pending}
            data-testid="automation-save"
          >
            {save.pending ? A.saving : A.save}
          </Button>
          <Button
            disabled={save.pending}
            onClick={() => {
              setDraft(draftFromPolicy(automationOf({})));
              submit(null);
            }}
          >
            {A.reset}
          </Button>
        </div>
        <ActionError error={save.error} message={A.invalid} />
      </form>
    </Card>
  );
}
