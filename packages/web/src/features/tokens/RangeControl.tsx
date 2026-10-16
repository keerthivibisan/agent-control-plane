import { inputClass } from '../../components/Input';
import { TOKENS_COPY, type DatePreset } from '../../lib/copy';
import { navigate } from '../../lib/router';
import { Segmented } from './Segmented';
import { presetDays, tokensHref, type TokensParams } from './tokens-params';

const PRESETS: readonly DatePreset[] = ['7d', '30d', 'all', 'custom'];

/** The date range. Every change is a new address, so a view can be bookmarked or shared. */
export function RangeControl({
  projectId,
  params,
  now,
}: {
  projectId: string;
  params: TokensParams;
  now: () => Date;
}) {
  const R = TOKENS_COPY.range;
  const go = (change: Partial<TokensParams>) =>
    navigate(tokensHref(projectId, { ...params, ...change }));
  const choose = (preset: DatePreset) => {
    if (preset === 'custom') {
      // Start the custom range from what is on screen, so switching changes nothing yet.
      const seed =
        params.preset === '7d' || params.preset === '30d' ? presetDays(params.preset, now()) : {};
      go({ preset, from: undefined, to: undefined, ...seed });
    } else go({ preset, from: undefined, to: undefined });
  };
  return (
    <form
      aria-label={R.label}
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-wrap items-end gap-x-3 gap-y-2"
      data-testid="range-control"
    >
      <Segmented
        label={R.label}
        hideLabel
        value={params.preset}
        onChange={choose}
        options={PRESETS.map((p) => ({ value: p, label: R.presets[p] }))}
      />
      {params.preset === 'custom' ? (
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-caption font-medium text-dim">
            {R.from}
            <input
              type="date"
              className={inputClass('w-40')}
              value={params.from ?? ''}
              max={params.to}
              onChange={(e) => go({ from: e.target.value || undefined })}
            />
          </label>
          <label className="flex flex-col gap-1 text-caption font-medium text-dim">
            {R.to}
            <input
              type="date"
              className={inputClass('w-40')}
              value={params.to ?? ''}
              min={params.from}
              onChange={(e) => go({ to: e.target.value || undefined })}
            />
          </label>
        </div>
      ) : null}
      {params.preset !== 'all' ? (
        <p className="w-full text-right text-caption text-dim">{R.utcNote}</p>
      ) : null}
    </form>
  );
}
