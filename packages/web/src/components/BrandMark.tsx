/**
 * The app mark: "AC" on an accent tile, from tokens only (no hard-coded colors), so it follows the
 * theme. Decorative: the app name next to it (or the link's label) names it.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[30%] bg-accent-fill leading-none font-semibold tracking-[-0.04em] text-accent-fill-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.18),inset_0_-1px_0_rgb(0_0_0/0.12)]"
    >
      {/* A soft highlight from the top, mixed from the accent itself. */}
      <span className="absolute inset-0 bg-gradient-to-b from-[color-mix(in_srgb,var(--color-accent-fill-ink)_18%,transparent)] to-transparent" />
      <span className="relative">AC</span>
    </span>
  );
}
