/**
 * Loading placeholders (DESIGN.md, "Loading"): soft blocks in the shape of what is coming,
 * instead of spinners. Decorative: `Skeleton` is `aria-hidden`; `LoadingBlock` pairs the blocks
 * with the page's own loading words, kept in the page for screen readers (visually hidden). The
 * shimmer stops under reduced motion.
 */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-skeleton=""
      className={`block animate-shimmer rounded-control bg-sunken ${className}`}
    />
  );
}

/** A few lines of text, the last one shorter. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={`h-3.5 ${i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full'}`}
        />
      ))}
    </span>
  );
}

/** A card-shaped placeholder: a title bar and a few lines. */
export function SkeletonCard() {
  return (
    <div aria-hidden="true" className="rounded-card border border-line bg-panel p-5">
      <Skeleton className="mb-4 h-4 w-1/3" />
      <SkeletonText lines={3} />
    </div>
  );
}

/**
 * The loading state of a section: the words (read by screen readers, visually hidden) and a
 * skeleton in place of the content.
 */
export function LoadingBlock({ label, cards = 1 }: { label: string; cards?: number }) {
  return (
    // No role="status": pages already have their own live regions, and a loading block must not
    // be mistaken for one of them.
    <div data-loading="" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
