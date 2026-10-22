import type { AttachmentDto } from '@acp/core/api';
import { useCallback, useRef, useState } from 'react';
import { ApiError, deleteAttachment, isTicketPagePath, uploadAttachment } from '../../lib/api';
import { useQueryStore } from '../../lib/query';
import { ATTACHMENT_COPY } from '../activity/copy';
import { checkFile, type FileRefusal } from './limits';

const C = ATTACHMENT_COPY;

/** One file the owner picked: being uploaded, uploaded, or refused (by the browser or server). */
export interface Upload {
  key: string;
  name: string;
  sizeBytes: number;
  status: 'uploading' | 'done' | 'failed';
  attachment: AttachmentDto | null;
  /** Why it was refused, in words, when it failed. */
  error: string | null;
}

export function refusalText(name: string, why: FileRefusal): string {
  switch (why.kind) {
    case 'tooBig':
      return C.refused.tooBig(name);
    case 'empty':
      return C.refused.empty(name);
    case 'type':
      return C.refused.type(name);
    case 'name':
      return C.refused.name(name);
    case 'tooMany':
      return C.refused.tooMany;
    case 'perComment':
      return C.refused.perComment(why.max);
  }
}

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.kind === 'http' && e.message.length > 0) {
    return `${C.uploadFailed} ${e.message}`;
  }
  return C.uploadFailed;
}

let counter = 0;

/**
 * Files the owner attaches (ADR-0026 §4), uploaded as soon as they are picked or dropped: each
 * is checked in the browser first, then sent on its own. `forComment` keeps them pending for a
 * comment that is still being written (their ids go with it, and nothing on the page refreshes
 * until it is posted); otherwise each upload lands on the ticket and the page refreshes.
 */
export function useUploads({
  ticketId,
  onTicket,
  forComment,
}: {
  ticketId: string;
  /** Attachments already on the ticket (they count against its limit). */
  onTicket: number;
  forComment: boolean;
}) {
  const store = useQueryStore();
  const [uploads, setUploads] = useState<Upload[]>([]);
  // The latest list for checks made while earlier uploads are still on their way.
  const latest = useRef<Upload[]>([]);
  const update = useCallback((fn: (list: Upload[]) => Upload[]) => {
    latest.current = fn(latest.current);
    setUploads(latest.current);
  }, []);

  const add = useCallback(
    (files: readonly File[]) => {
      for (const file of files) {
        const key = `upload-${++counter}`;
        const live = latest.current.filter((u) => u.status !== 'failed');
        const check = checkFile(file, {
          onTicket: onTicket + live.length,
          ...(forComment ? { onComment: live.length } : {}),
        });
        if (!check.ok) {
          update((l) => [
            ...l,
            {
              key,
              name: file.name,
              sizeBytes: file.size,
              status: 'failed',
              attachment: null,
              error: refusalText(file.name, check.why),
            },
          ]);
          continue;
        }
        update((l) => [
          ...l,
          {
            key,
            name: file.name,
            sizeBytes: file.size,
            status: 'uploading',
            attachment: null,
            error: null,
          },
        ]);
        uploadAttachment(store.client, ticketId, {
          data: file,
          name: file.name,
          mimeType: check.mimeType,
        })
          .then((attachment) => {
            update((l) => l.map((u) => (u.key === key ? { ...u, status: 'done', attachment } : u)));
            if (!forComment) {
              // On the ticket: shown with its attachments once the list is read again.
              update((l) => l.filter((u) => u.key !== key));
              store.invalidate(isTicketPagePath);
            }
          })
          .catch((e: unknown) => {
            update((l) =>
              l.map((u) => (u.key === key ? { ...u, status: 'failed', error: errorText(e) } : u)),
            );
          });
      }
    },
    [store, ticketId, onTicket, forComment, update],
  );

  /** Takes a file off the list; an uploaded one is deleted on the server too. */
  const remove = useCallback(
    (key: string) => {
      const u = latest.current.find((x) => x.key === key);
      update((l) => l.filter((x) => x.key !== key));
      if (u?.attachment) {
        void deleteAttachment(store.client, u.attachment.id).catch(() => {
          // Still on the ticket: it shows in its attachments, where it can be deleted again.
          store.invalidate(isTicketPagePath);
        });
      }
    },
    [store, update],
  );

  /** Forgets every file (after the comment that carried them was posted). */
  const clear = useCallback(() => update(() => []), [update]);

  const ids = uploads.flatMap((u) =>
    u.status === 'done' && u.attachment ? [u.attachment.id] : [],
  );
  const busy = uploads.some((u) => u.status === 'uploading');
  return { uploads, ids, busy, add, remove, clear };
}
