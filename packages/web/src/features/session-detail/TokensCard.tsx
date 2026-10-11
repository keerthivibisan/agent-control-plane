import type { SessionDetailDto, UsageTotalsDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { InfoTip } from '../../components/InfoTip';
import { TokenBreakdown } from '../../components/TokenBreakdown';
import {
  GLOSSARY,
  SESSION_DETAIL_COPY,
  sharedMessagesText,
  type GlossaryKey,
} from '../../lib/copy';

const COPY = SESSION_DETAIL_COPY.tokens;

function Part({
  term,
  usage,
  testId,
}: {
  term: Extract<GlossaryKey, 'tokensThisSession' | 'tokensWithHelpers'>;
  usage: UsageTotalsDto;
  testId: string;
}) {
  const { term: label, tip } = GLOSSARY[term];
  return (
    <section aria-label={label} className="rounded-control bg-sunken/60 px-4 py-3.5">
      <h3 className="mb-3 flex items-center gap-1 font-medium">
        {label}
        <InfoTip tip={tip} label={label} />
      </h3>
      <TokenBreakdown usage={usage} label={label} testId={testId} />
    </section>
  );
}

/**
 * "Tokens": this session's own tokens and, when it started helper agents, the total with them.
 * The second already includes the first, so they sit next to each other and are never added.
 */
export function TokensCard({ s }: { s: SessionDetailDto }) {
  // Aggregate equals direct when nothing hangs below this session; then one block says it all.
  const hasHelperUsage =
    s.childCount > 0 || s.aggregateUsage.recordCount !== s.directUsage.recordCount;
  return (
    <Card title={COPY.title} description={hasHelperUsage ? COPY.description : undefined}>
      <div className="flex flex-col gap-3">
        <Part term="tokensThisSession" usage={s.directUsage} testId="usage-direct" />
        {hasHelperUsage ? (
          <Part term="tokensWithHelpers" usage={s.aggregateUsage} testId="usage-aggregate" />
        ) : (
          <p className="text-dim">{COPY.noHelpers}</p>
        )}
        {s.ambiguousAttributionCount > 0 ? (
          <p className="flex items-start gap-1 text-dim" data-testid="shared-messages">
            <span>
              {GLOSSARY.sharedMessages.term}: {sharedMessagesText(s.ambiguousAttributionCount)}
            </span>
            <InfoTip tip={GLOSSARY.sharedMessages.tip} label={GLOSSARY.sharedMessages.term} />
          </p>
        ) : null}
      </div>
    </Card>
  );
}
