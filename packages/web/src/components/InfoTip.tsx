import { InfoIcon } from './icons';
import { useTooltip } from './Tooltip';

/**
 * The ⓘ next to an unfamiliar term. A real button, so it is reachable by keyboard; the tip opens
 * on hover and focus, and on click/tap for touch screens. Its accessible name says
 * which term it explains; the tip text becomes its description while open.
 */
export function InfoTip({ tip, label }: { tip: string; label: string }) {
  const { triggerProps, bubble } = useTooltip(tip);
  return (
    <button
      type="button"
      {...triggerProps}
      // Touch screens have no hover: a tap opens the tip; tapping elsewhere (blur) closes it.
      onClick={triggerProps.onFocus}
      aria-label={`About ${label}`}
      data-tip={tip}
      className="inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-full align-middle text-dim hover:text-ink"
    >
      <InfoIcon size={15} />
      {bubble}
    </button>
  );
}
