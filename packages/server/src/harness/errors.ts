/**
 * Why a harness operation could not start. Check failures are not errors: they come back as
 * `CheckRun` rows with a status. These are the refusals P4-D maps to an ErrorDto.
 */
export type HarnessErrorCode =
  /** The folder is not an absolute path to an existing directory. */
  | 'invalid-root'
  | 'not-a-git-repo'
  | 'no-commits'
  /** A git command needed to prepare or remove the temporary checkout failed. */
  | 'git-failed';

export class HarnessError extends Error {
  override readonly name = 'HarnessError';
  constructor(
    readonly code: HarnessErrorCode,
    message: string,
  ) {
    super(message);
  }
}
