import type { AttachmentDto } from '@acp/core/api';
import {
  Download,
  File,
  FileArchive,
  FileText,
  Paperclip,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { deleteAttachment } from '../../lib/api';
import { ActionError } from '../control/bits';
import { ATTACHMENT_COPY } from '../activity/copy';
import { useTicketAction } from '../ticket/actions';
import { ATTACHMENT_ACCEPT, formatBytes, isImage } from './limits';
import type { Upload } from './use-uploads';

const C = ATTACHMENT_COPY;

function Icon({ of: Lucide, size = 16 }: { of: LucideIcon; size?: number }) {
  return <Lucide size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" />;
}

function fileIcon(mimeType: string): LucideIcon {
  if (mimeType === 'application/zip' || mimeType === 'application/gzip') return FileArchive;
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return FileText;
  return File;
}

/** Delete, then a one-step confirmation in place (the file goes for the agents too). */
function DeleteAttachment({ attachment }: { attachment: AttachmentDto }) {
  const del = useTicketAction(deleteAttachment);
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button
        variant="quiet"
        size="sm"
        className="size-7 px-0"
        aria-label={C.deleteLabel(attachment.name)}
        title={C.delete}
        onClick={() => {
          del.reset();
          setAsking(true);
        }}
      >
        <Icon of={Trash2} size={14} />
      </Button>
    );
  }
  return (
    <span
      role="group"
      aria-label={C.confirmDelete(attachment.name)}
      className="flex basis-full flex-wrap items-center gap-2 text-caption"
    >
      <span className="text-ink">{C.confirmDelete(attachment.name)}</span>
      <Button
        size="sm"
        variant="danger"
        disabled={del.pending}
        // The confirmation replaces the button the owner just pressed.
        autoFocus
        onClick={() => void del.run(attachment.id)}
      >
        {C.confirm}
      </Button>
      <Button size="sm" disabled={del.pending} onClick={() => setAsking(false)}>
        {C.cancel}
      </Button>
      <ActionError error={del.error} message={C.deleteFailed} />
    </span>
  );
}

/** An image: its thumbnail, which opens the full picture in a new tab. */
function ImageAttachment({
  attachment,
  canDelete,
}: {
  attachment: AttachmentDto;
  canDelete: boolean;
}) {
  return (
    <li
      className="flex w-40 flex-col gap-1"
      data-testid="attachment"
      data-kind="image"
      data-name={attachment.name}
    >
      <a
        href={attachment.contentUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={C.open(attachment.name)}
        className="block overflow-hidden rounded-control border border-line bg-sunken hover:border-line-strong"
      >
        <img
          src={attachment.contentUrl}
          alt={attachment.name}
          loading="lazy"
          decoding="async"
          className="h-28 w-full object-cover"
          data-testid="attachment-thumbnail"
        />
      </a>
      <span className="flex min-w-0 flex-wrap items-center gap-1 text-caption text-dim">
        <span className="min-w-0 flex-1 truncate" title={attachment.name}>
          {attachment.name}
        </span>
        <span className="tabular-nums">{formatBytes(attachment.sizeBytes)}</span>
        {canDelete ? <DeleteAttachment attachment={attachment} /> : null}
      </span>
    </li>
  );
}

/** Any other file: a chip with its name and size, downloaded on click. */
function FileAttachment({
  attachment,
  canDelete,
}: {
  attachment: AttachmentDto;
  canDelete: boolean;
}) {
  return (
    <li
      className="flex max-w-full min-w-0 flex-wrap items-center gap-1 rounded-control border border-line bg-subtle py-0.5 pr-0.5 pl-2"
      data-testid="attachment"
      data-kind="file"
      data-name={attachment.name}
    >
      <a
        href={attachment.contentUrl}
        download={attachment.name}
        aria-label={C.download(attachment.name)}
        className="flex min-w-0 items-center gap-1.5 py-1 text-ink hover:text-accent"
      >
        <span className="text-dim">
          <Icon of={fileIcon(attachment.mimeType)} size={14} />
        </span>
        <span className="min-w-0 truncate font-medium">{attachment.name}</span>
        <span className="text-caption text-dim tabular-nums">
          {formatBytes(attachment.sizeBytes)}
        </span>
        <span className="text-dim">
          <Icon of={Download} size={13} />
        </span>
      </a>
      {canDelete ? <DeleteAttachment attachment={attachment} /> : null}
    </li>
  );
}

/** A comment's or the ticket's attachments: images as thumbnails, then the other files. */
export function AttachmentList({
  attachments,
  label,
  canDelete,
  testId,
}: {
  attachments: readonly AttachmentDto[];
  /** What they belong to, for the list's accessible name. */
  label: string;
  canDelete: boolean;
  testId?: string;
}) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => isImage(a.mimeType));
  const files = attachments.filter((a) => !isImage(a.mimeType));
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      {images.length > 0 ? (
        <ul aria-label={C.listLabel(label)} className="flex flex-wrap gap-3">
          {images.map((a) => (
            <ImageAttachment key={a.id} attachment={a} canDelete={canDelete} />
          ))}
        </ul>
      ) : null}
      {files.length > 0 ? (
        <ul aria-label={C.listLabel(label)} className="flex flex-wrap gap-2">
          {files.map((a) => (
            <FileAttachment key={a.id} attachment={a} canDelete={canDelete} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Files on their way: their name, size and state, each removable. */
export function UploadList({
  uploads,
  onRemove,
}: {
  uploads: readonly Upload[];
  onRemove: (key: string) => void;
}) {
  if (uploads.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" data-testid="uploads" aria-live="polite">
      {uploads.map((u) => (
        <li
          key={u.key}
          className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-control border px-2 py-1 text-caption ${
            u.status === 'failed' ? 'border-danger/40 bg-danger-soft' : 'border-line bg-subtle'
          }`}
          data-testid="upload"
          data-status={u.status}
        >
          <span className="text-dim">
            <Icon of={Paperclip} size={13} />
          </span>
          <span className="min-w-0 truncate font-medium text-ink">{u.name}</span>
          <span className="text-dim tabular-nums">{formatBytes(u.sizeBytes)}</span>
          <span className={u.status === 'failed' ? 'text-danger' : 'text-dim'}>
            {u.status === 'uploading' ? C.uploading : u.status === 'done' ? C.uploaded : u.error}
          </span>
          <Button
            variant="quiet"
            size="sm"
            className="ml-auto size-6 px-0"
            aria-label={C.remove(u.name)}
            disabled={u.status === 'uploading'}
            onClick={() => onRemove(u.key)}
          >
            <Icon of={X} size={13} />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** "Attach files": a button over a hidden file input (several files, the allowed types). */
export function AttachButton({
  onFiles,
  disabled = false,
  label = C.attach,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const id = useId();
  return (
    <>
      <input
        ref={input}
        id={id}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="attachment-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          // Cleared, so picking the same file again still reports a change.
          e.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      <Button
        size="sm"
        variant="quiet"
        disabled={disabled}
        title={C.attachTip}
        onClick={() => input.current?.click()}
      >
        <Icon of={Paperclip} size={14} />
        {label}
      </Button>
    </>
  );
}

function hasFiles(e: DragEvent): boolean {
  return [...e.dataTransfer.types].includes('Files');
}

/** A place files can be dropped on; while files are over it, it says so. */
export function DropZone({
  onFiles,
  children,
  className = '',
  testId,
}: {
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [over, setOver] = useState(0);
  return (
    <div
      className={`relative ${className}`}
      data-testid={testId}
      data-dragging={over > 0 ? '' : undefined}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver((n) => n + 1);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        setOver((n) => Math.max(0, n - 1));
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(0);
        const files = [...e.dataTransfer.files];
        if (files.length > 0) onFiles(files);
      }}
    >
      {children}
      {over > 0 ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-card border-2 border-dashed border-accent bg-accent-soft/90 font-medium text-accent"
        >
          {C.dropHere}
        </div>
      ) : null}
    </div>
  );
}
