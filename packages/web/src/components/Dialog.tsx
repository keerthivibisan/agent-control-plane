import * as RadixDialog from '@radix-ui/react-dialog';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

/**
 * A modal dialog (Radix Dialog): a dimmed backdrop, a labelled `role="dialog"` panel with
 * `aria-modal`, focus moved in on open (to `[data-autofocus]`, else the first control), Tab kept
 * inside, Escape and a click on the backdrop close it, and focus returns to whatever opened it.
 *
 * Open while mounted: the parent renders it to open it and removes it to close it (`onClose` is
 * the request to close). The same API as the board's own dialog, so features can switch over.
 * The panel carries Radix's `data-state`; never put the app's own `data-state` on it.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  testId,
  wide = false,
  closeLabel,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  wide?: boolean;
  /** Accessible name of a close (×) button in the corner; no button without it. */
  closeLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Whatever had focus before the dialog opened gets it back when the dialog goes away (Radix only
  // does this for its own Trigger). Radix runs the close autofocus just after unmount (next tick).
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);

  return (
    <RadixDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <RadixDialog.Portal>
        {/* The overlay is also the scroll container, so a tall dialog scrolls with the wheel. */}
        <RadixDialog.Overlay className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay px-4 py-[8vh] data-[state=open]:animate-fade-in">
          <RadixDialog.Content
            ref={panelRef}
            aria-modal="true"
            data-testid={testId}
            // Without a description, say so; otherwise Radix warns about a missing one.
            {...(description ? {} : { 'aria-describedby': undefined })}
            onOpenAutoFocus={(e) => {
              const target = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
              if (target) {
                e.preventDefault();
                target.focus();
              }
            }}
            onCloseAutoFocus={(e) => {
              // To the opener captured above, not to a Radix trigger (there is none).
              e.preventDefault();
              const opener = openerRef.current;
              if (opener?.isConnected) opener.focus();
            }}
            className={`relative w-full ${wide ? 'max-w-xl' : 'max-w-md'} rounded-card border border-line bg-panel-raised p-5 shadow-pop focus:outline-none data-[state=open]:animate-dialog-in`}
          >
            <RadixDialog.Title className="pr-8 text-title font-semibold">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="mt-1 text-dim">
                {description}
              </RadixDialog.Description>
            ) : null}
            {closeLabel ? (
              <RadixDialog.Close
                aria-label={closeLabel}
                className="absolute top-3.5 right-3.5 inline-flex size-7 items-center justify-center rounded-control text-dim transition-colors hover:bg-hover hover:text-ink"
              >
                <CloseIcon size={16} />
              </RadixDialog.Close>
            ) : null}
            <div className="mt-5">{children}</div>
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
