import type { CodeMapErrorCode } from '@acp/core';

/** A code map build that did not finish; `code` is what the summary shows (never a message). */
export class CodeMapBuildError extends Error {
  override readonly name = 'CodeMapBuildError';
  constructor(readonly code: CodeMapErrorCode) {
    super(`code map build failed: ${code}`);
  }
}

/**
 * ADR-0036: the build's project was removed while it ran, so its result is dropped unwritten.
 * Never recorded as a failure (the project's rows are gone).
 */
export class CodeMapBuildCancelled extends Error {
  override readonly name = 'CodeMapBuildCancelled';
  constructor() {
    super('code map build cancelled');
  }
}
