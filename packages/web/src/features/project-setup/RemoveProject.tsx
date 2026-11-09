import type { ProjectDto, ProjectRemovalPreviewDto } from '@acp/core/api';
import { useCallback, useId, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { AlertIcon } from '../../components/icons';
import { TextInput, hintClass, labelClass } from '../../components/Input';
import { QueryView } from '../../components/QueryView';
import { forgetLastProject } from '../../app/last-project';
import {
  paths,
  projectRemovalPaths,
  projectRemovalSchemas,
  removeProject,
  type ApiClient,
} from '../../lib/api';
import { PROJECT_SETUP_COPY, RUN_STATUS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href, navigate } from '../../lib/router';
import { ActionError } from '../control/bits';
import { DeleteIcon } from '../workflow/icons';
import { useSetupAction } from './actions';

const R = PROJECT_SETUP_COPY.settings.remove;

/**
 * The Danger zone's "Remove from ACP" (ADR-0036): a dialog that says what goes and what stays,
 * lists the runs that must be stopped first, and removes only once the owner types the project's
 * name. On success the app forgets the project and opens All projects.
 */
export function RemoveProjectButton({ project }: { project: ProjectDto }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div>
        <Button variant="danger" onClick={() => setOpen(true)}>
          <DeleteIcon size={14} />
          {R.button}
        </Button>
      </div>
      {open ? <RemoveProjectDialog project={project} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RemoveProjectDialog({ project, onClose }: { project: ProjectDto; onClose: () => void }) {
  const preview = useApiQuery(
    projectRemovalPaths.preview(project.id),
    projectRemovalSchemas.preview,
  );
  // A refusal refreshes the preview (runs started or ended). A success refreshes only the project
  // list: this project's own pages answer 404 now, and the app is leaving them.
  const previewPath = projectRemovalPaths.preview(project.id);
  const removed = useRef(false);
  const invalidate = useCallback(
    (key: string) => (removed.current ? key === paths.projects() : key === previewPath),
    [previewPath],
  );
  const removeAndMark = useCallback(async (client: ApiClient, id: string) => {
    await removeProject(client, id);
    removed.current = true;
  }, []);
  const remove = useSetupAction(removeAndMark, invalidate);
  const [typed, setTyped] = useState('');
  const inputId = useId();

  const doRemove = async () => {
    const ok = await remove.run(project.id);
    // The removal resolves to undefined; null is a failure, explained in the dialog.
    if (ok === null) return;
    forgetLastProject(project.id);
    navigate(href.projects());
  };

  return (
    <Dialog
      title={R.title(project.name)}
      description={R.description}
      onClose={onClose}
      testId="remove-project-dialog"
      wide
    >
      <QueryView query={preview}>
        {(p) => (
          <div className="flex flex-col gap-4">
            {p.busy ? <BusyNotice preview={p} /> : <Summary preview={p} />}
            <ActionError error={remove.error} message={R.failed} />
            {!p.busy ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={inputId} className={labelClass}>
                  {R.confirmLabel(p.name)}
                </label>
                <TextInput
                  id={inputId}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-autofocus
                />
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose} disabled={remove.pending}>
                {R.cancel}
              </Button>
              <Button
                variant="danger"
                onClick={() => void doRemove()}
                disabled={p.busy || typed !== p.name || remove.pending}
              >
                <DeleteIcon size={14} />
                {remove.pending ? R.removing : R.confirm}
              </Button>
            </div>
          </div>
        )}
      </QueryView>
    </Dialog>
  );
}

function Summary({ preview }: { preview: ProjectRemovalPreviewDto }) {
  return (
    <div className="flex flex-col gap-3" data-testid="remove-project-summary">
      <section>
        <h3 className="text-caption font-semibold text-danger">{R.deletedTitle}</h3>
        <ul className="mt-1 list-disc pl-5 text-dim">
          {R.deleted(preview).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-caption font-semibold text-ink">{R.keptTitle}</h3>
        <ul className="mt-1 list-disc pl-5 text-dim">
          {R.kept(preview.rootPath).map((line) => (
            <li key={line} className="break-all">
              {line}
            </li>
          ))}
        </ul>
      </section>
      <p className={hintClass}>{R.pruneNote}</p>
    </div>
  );
}

function BusyNotice({ preview }: { preview: ProjectRemovalPreviewDto }) {
  return (
    <div className="flex flex-col gap-2" data-testid="remove-project-busy">
      <p
        role="status"
        className="flex items-start gap-2.5 rounded-control border border-danger/20 bg-danger-soft/50 px-3 py-2.5"
      >
        <AlertIcon size={16} className="mt-0.5 shrink-0 text-danger" />
        <span>{preview.busyReason === 'checks-running' ? R.checksBusy : R.busy}</span>
      </p>
      {preview.activeRuns.length > 0 ? (
        <section>
          <h3 className="text-caption font-semibold text-ink">{R.busyTitle}</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {preview.activeRuns.map((run) => (
              <li key={run.runId} className="flex items-center justify-between gap-3">
                <a
                  href={
                    run.ticketId !== null
                      ? href.ticket({ id: run.ticketId, projectId: preview.projectId })
                      : href.run({ id: run.runId, projectId: preview.projectId })
                  }
                  className="min-w-0 truncate text-accent hover:underline"
                >
                  {R.runLabel(run.ticketKey, run.ticketTitle)}
                </a>
                <span className="shrink-0 text-caption text-dim">
                  {RUN_STATUS_COPY[run.status].word}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
