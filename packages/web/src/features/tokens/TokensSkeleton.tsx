import { Skeleton } from '../../components/Skeleton';

/**
 * The Tokens page while its one request loads: five tiles and the chart card in their real
 * shape, so nothing jumps when the numbers arrive. The loading words stay for screen readers.
 */
export function TokensSkeleton({ label }: { label: string }) {
  return (
    <div data-loading="" className="flex flex-col gap-6">
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      >
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-card border border-line bg-panel p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-24" />
            <Skeleton className="mt-2.5 h-3 w-32" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="rounded-card border border-line bg-panel p-5">
        <Skeleton className="h-4 w-28" />
        <div className="mt-6 grid gap-8 xl:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    </div>
  );
}
