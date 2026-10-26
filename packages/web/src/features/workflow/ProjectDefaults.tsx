import { HARD_MAX_HELPERS } from '@acp/core';
import type { ProjectAgentSetupDto } from '@acp/core/api';
import { useId, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, CheckIcon } from '../../components/icons';
import { isWorkflowGraphPath, updateProjectSetup } from '../../lib/api';
import {
  PROJECT_SETUP_COPY,
  REVIEW_LOOP_COPY,
  WORKFLOW_COPY,
  WORKFLOW_GRAPH_COPY,
} from '../../lib/copy';
import { useSetupAction } from '../project-setup/actions';
import { NumberChoice, TextField } from '../project-setup/fields';
import { DEPTH_CHOICES, HELPER_CHOICES, parseTokens } from '../project-setup/setup-form';
import { ApprovalModeChoice, CommandListEditor, ModeWarning } from '../review-loop/ApprovalsEditor';
import {
  limitsDraft,
  refusalMessage,
  sameLimits,
  setupRequest,
  type DraftErrors,
  type LimitsDraft,
} from './draft';

const P = WORKFLOW_COPY.panel;
const A = PROJECT_SETUP_COPY.agents;
const RL = REVIEW_LOOP_COPY;
const D = WORKFLOW_GRAPH_COPY.defaults;
const S = WORKFLOW_GRAPH_COPY.save;

/**
 * The project's helper limits and approval mode, kept on the Workflow page (they were on the
 * version 1 Helpers panel). They save through PUT …/setup, their one source, apart from the graph:
 * a block set to "Project default" uses this mode. Like the settings page, the draft starts from
 * the saved values, and after a save the refetched values equal it, so nothing typed is reset.
 */
export function ProjectDefaults({
  projectId,
  setup,
}: {
  projectId: string;
  setup: ProjectAgentSetupDto;
}) {
  const name = useId();
  const saved = useMemo(() => limitsDraft(setup), [setup]);
  const [limits, setLimits] = useState<LimitsDraft>(saved);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [justSaved, setJustSaved] = useState(false);
  const invalidate = useMemo(() => isWorkflowGraphPath(projectId), [projectId]);
  const save = useSetupAction(updateProjectSetup, invalidate);
  const dirty = !sameLimits(limits, saved);
  const tokens = parseTokens(limits.budget);

  const change = (patch: Partial<LimitsDraft>) => {
    setJustSaved(false);
    setLimits((l) => ({ ...l, ...patch }));
  };
  const submit = async () => {
    const r = setupRequest(setup, limits);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    if ((await save.run(projectId, r.request)) !== null) setJustSaved(true);
  };

  return (
    <Card title={D.title} tip={D.tip} description={D.description} testId="project-defaults">
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <h3 className="text-title font-semibold">{P.limitsTitle}</h3>
          <NumberChoice
            legend={A.helpers}
            hint={A.helpersHint(HARD_MAX_HELPERS)}
            name={`${name}-helpers`}
            value={limits.maxConcurrentHelpers}
            choices={HELPER_CHOICES}
            onChange={(n) => change({ maxConcurrentHelpers: n })}
            valueText={A.helpersValue}
          />
          <NumberChoice
            legend={A.depth}
            hint={A.depthOptions[limits.maxDepth].hint}
            name={`${name}-depth`}
            value={limits.maxDepth}
            choices={DEPTH_CHOICES}
            onChange={(d) => change({ maxDepth: d >= 2 ? 2 : 1 })}
            valueText={P.depthValue}
          />
          <TextField
            label={A.budget}
            hint={tokens === null ? A.budgetHint : `${A.budgetValue(tokens)}. ${A.budgetHint}`}
            error={errors.budget}
            value={limits.budget}
            onChange={(budget) => change({ budget })}
            numeric
            inputClassName="max-w-48"
          />
        </div>
        <div className="flex flex-col gap-4" data-testid="approvals-editor">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-title font-semibold">{RL.approvals.title}</h3>
            <p className="text-caption text-dim">{RL.approvals.note}</p>
          </div>
          <ApprovalModeChoice
            value={limits.approvalMode}
            onChange={(approvalMode) => change({ approvalMode })}
          />
          <ModeWarning mode={limits.approvalMode} />
          {limits.approvalMode === 'auto' || limits.commands.length > 0 ? (
            <CommandListEditor
              commands={limits.commands}
              active={limits.approvalMode === 'auto'}
              onChange={(commands) => change({ commands })}
            />
          ) : null}
        </div>
      </div>
      <div className="-mx-4 mt-6 -mb-4 flex flex-col gap-3 rounded-b-card border-t border-line bg-subtle px-4 py-3">
        {save.error ? (
          <div className="flex flex-col gap-1.5" data-testid="defaults-refusal">
            <p
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-danger"
            >
              <AlertIcon size={15} className="mt-0.5 shrink-0" />
              <span className="min-w-0">
                {WORKFLOW_COPY.refusals.limits} {refusalMessage(save.error)}
              </span>
            </p>
            <Details>
              <ErrorNotice error={save.error} />
            </Details>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!dirty || save.pending}
            aria-label={D.saveTitle}
          >
            {save.pending ? S.saving : S.save}
          </Button>
          {dirty ? (
            <>
              <Button
                variant="quiet"
                onClick={() => {
                  setLimits(saved);
                  setErrors({});
                }}
                disabled={save.pending}
              >
                {S.discard}
              </Button>
              <span
                className="ml-auto inline-flex items-center gap-1.5 text-caption text-dim"
                data-testid="defaults-unsaved"
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                {S.unsaved}
              </span>
            </>
          ) : justSaved ? (
            <span
              role="status"
              data-testid="defaults-saved"
              className="inline-flex items-center gap-1.5 text-caption font-medium text-success"
            >
              <CheckIcon size={15} />
              {S.saved}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
