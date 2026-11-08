import type { CodeMapErrorCode } from '@acp/core';

/** A code map build that did not finish; `code` is what the summary shows (never a message). */
export class CodeMapBuildError extends Error {
  override readonly name = 'CodeMapBuildError';
  constructor(readonly code: CodeMapErrorCode) {
    super(`code map build failed: ${code}`);
  }
}
