import { useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { InfoIcon } from '../../components/icons';
import { TOKEN_TYPES, TOKENS_PAGE } from '../../lib/copy';
import { TOKEN_TYPE_COLOR } from '../../lib/tokens';

const STORAGE_KEY = 'acp.tokens.explainer';

/** Per-viewer convenience only: storage can be missing or throw (private windows), so guard it. */
function readHidden(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'hidden';
  } catch {
    return false;
  }
}
function writeHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(STORAGE_KEY, 'hidden');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembering the choice is harmless: the card just opens again next time.
  }
}

/**
 * The four token types in plain words, and why they are never added up. Open on a first visit;
 * once hidden it stays a one-line link (remembered in this browser).
 */
export function TokenExplainer() {
  const [hidden, setHidden] = useState(readHidden);
  const { explainer } = TOKENS_PAGE;
  const toggle = (next: boolean) => {
    setHidden(next);
    writeHidden(next);
  };

  if (hidden) {
    return (
      <div>
        <Button variant="quiet" onClick={() => toggle(false)} aria-expanded={false}>
          <InfoIcon size={15} />
          {explainer.show}
        </Button>
      </div>
    );
  }
  return (
    <Card
      title={explainer.title}
      description={explainer.intro}
      testId="token-explainer"
      actions={
        <Button variant="quiet" onClick={() => toggle(true)} aria-expanded={true}>
          {explainer.hide}
        </Button>
      }
    >
      <dl className="grid gap-x-8 gap-y-3 md:grid-cols-2">
        {TOKEN_TYPES.map((t) => (
          <div key={t.key} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className={`mt-1.5 inline-block size-2.5 shrink-0 rounded-sm ${TOKEN_TYPE_COLOR[t.key].bg}`}
            />
            <div>
              <dt className="font-medium">{t.label}</dt>
              <dd className="text-dim">{t.tip}</dd>
            </div>
          </div>
        ))}
      </dl>
      <p className="mt-4 border-t border-line pt-3 text-dim">{explainer.why}</p>
    </Card>
  );
}
