import { NOT_REPORTED, tokenType } from '../lib/copy';
import { formatCount } from '../lib/format';
import type { TokenCategory } from '../lib/tokens';
import { Tooltip } from './Tooltip';

function unitFor(value: number, type?: TokenCategory): string {
  const unit = type ? tokenType(type).unit : 'tokens';
  return value === 1 ? unit.replace(/s$/, '') : unit;
}

/** "1,540 output tokens" / "1 input token" / "12 tokens". */
export function tokenText(value: number, type?: TokenCategory): string {
  return `${formatCount(value)} ${unitFor(value, type)}`;
}

/**
 * A token count with its unit. `null` means the source did not report it: it reads "Not
 * reported", never 0. In compact form (12.4K) the exact value is in a hover/focus tooltip.
 */
export function TokenValue({
  value,
  type,
  compact = false,
  showUnit = true,
}: {
  value: number | null;
  /** Names the unit ("output tokens"); without it the unit is just "tokens". */
  type?: TokenCategory;
  compact?: boolean;
  /** False where a nearby label already names the unit (e.g. under "Output tokens"). */
  showUnit?: boolean;
}) {
  if (value === null) {
    return (
      <span className="text-unavailable" data-state="unavailable">
        {NOT_REPORTED}
      </span>
    );
  }
  const exact = tokenText(value, type);
  const number = formatCount(value, compact ? 'compact' : 'full');
  const shown = showUnit ? `${number} ${unitFor(value, type)}` : number;
  // Only a compact number hides precision; otherwise there is nothing for a tooltip to add.
  if (number === formatCount(value)) {
    return (
      <span className="tabular-nums" data-state="available">
        {shown}
      </span>
    );
  }
  return (
    <Tooltip content={exact} className="tabular-nums">
      <span data-state="available">{shown}</span>
    </Tooltip>
  );
}
