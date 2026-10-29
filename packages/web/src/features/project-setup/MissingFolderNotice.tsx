import type { ApiError } from '../../lib/api';
import { AlertIcon } from '../../components/icons';
import { PROJECT_SETUP_COPY } from '../../lib/copy';
import { href } from '../../lib/router';
import { alertClass } from '../control/bits';

const M = PROJECT_SETUP_COPY.settings.missingFolder;

/** True when the server refused because the project's saved folder no longer exists. */
export function isMissingFolder(error: ApiError | null | undefined): boolean {
  return error != null && error.kind === 'http' && error.code === 'invalid_root';
}

/**
 * Tells the owner the project's folder is gone, with a link to Settings where it is changed. Shows
 * nothing for any other error, so it sits next to the generic error without hiding it.
 */
export function MissingFolderNotice({
  error,
  projectId,
}: {
  error: ApiError | null | undefined;
  projectId?: string | undefined;
}) {
  if (!isMissingFolder(error)) return null;
  return (
    <p role="alert" data-testid="missing-folder" className={alertClass}>
      <AlertIcon size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        <strong>{M.title}.</strong> {M.text}
        {projectId !== undefined ? (
          <>
            {' '}
            <a className="underline" href={href.projectSettings(projectId)}>
              {M.link}
            </a>
          </>
        ) : null}
      </span>
    </p>
  );
}
