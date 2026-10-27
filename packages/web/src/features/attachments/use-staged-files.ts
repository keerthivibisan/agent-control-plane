import type { AttachmentMimeType } from '@acp/core';
import { useCallback, useRef, useState } from 'react';
import { checkFile } from './limits';
import { refusalText } from './use-uploads';

/** A file picked before its ticket exists: kept to upload once the ticket is created. */
export interface StagedFile {
  key: string;
  file: File;
  mimeType: AttachmentMimeType;
}

/** A file the browser's checks refused; it is never uploaded. */
export interface StagedFailure {
  key: string;
  name: string;
  sizeBytes: number;
  /** Why it was refused, in words. */
  error: string;
}

let counter = 0;

/**
 * Files picked in New ticket, held until the ticket exists (ADR-0026 §4). Each is checked as in
 * `useUploads`, with the files already staged counting against the ticket's limit; a refused one
 * stays listed as a failure until removed.
 */
export function useStagedFiles() {
  const [valid, setValid] = useState<StagedFile[]>([]);
  const [failures, setFailures] = useState<StagedFailure[]>([]);
  // The latest valid list, for several files added in one go.
  const latest = useRef<StagedFile[]>([]);

  const add = useCallback((files: readonly File[]) => {
    const refused: StagedFailure[] = [];
    for (const file of files) {
      const key = `staged-${++counter}`;
      const check = checkFile(file, { onTicket: latest.current.length });
      if (!check.ok) {
        refused.push({
          key,
          name: file.name,
          sizeBytes: file.size,
          error: refusalText(file.name, check.why),
        });
        continue;
      }
      latest.current = [...latest.current, { key, file, mimeType: check.mimeType }];
    }
    setValid(latest.current);
    if (refused.length > 0) setFailures((l) => [...l, ...refused]);
  }, []);

  const remove = useCallback((key: string) => {
    latest.current = latest.current.filter((s) => s.key !== key);
    setValid(latest.current);
    setFailures((l) => l.filter((f) => f.key !== key));
  }, []);

  return { valid, failures, add, remove };
}

export type StagedFiles = ReturnType<typeof useStagedFiles>;
