import type { ComponentType } from 'react';
import { isProjectPageAvailable } from '../../app/project-pages';
import { Card } from '../../components/Card';
import {
  ArrowRightIcon,
  CheckIcon,
  HarnessIcon,
  TicketIcon,
  type IconProps,
} from '../../components/icons';
import { InfoTip } from '../../components/InfoTip';
import { HARNESS_PAGE_COPY } from '../../lib/copy';
import { href } from '../../lib/router';

const C = HARNESS_PAGE_COPY.usage;

interface Use {
  id: string;
  icon: ComponentType<IconProps>;
  title: string;
  text: string;
  tip?: string;
}

const USES: readonly Use[] = [
  { id: 'review', icon: TicketIcon, ...C.review },
  { id: 'demand', icon: HarnessIcon, ...C.demand },
  { id: 'merge', icon: CheckIcon, ...C.merge },
];

/**
 * When the checks run (docs/phase-4/README.md: on entering review and on demand) and what they
 * decide (ADR-0017 §4: a failed required check blocks a plain merge; "merge anyway" needs a
 * reason). Links to the workflow's Review & merge stage once that page exists.
 */
export function UsageCard({
  projectId,
  className = '',
}: {
  projectId: string;
  className?: string;
}) {
  return (
    <Card title={C.title} className={className} testId="harness-usage">
      <ul className="flex flex-col gap-5">
        {USES.map(({ id, icon: Icon, title, text, tip }) => (
          <li key={id} data-use={id} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-control border border-line bg-sunken text-dim"
            >
              <Icon size={16} />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1 font-medium">
                {title}
                {tip ? <InfoTip tip={tip} label={title} /> : null}
              </p>
              <p className="text-dim">{text}</p>
            </div>
          </li>
        ))}
      </ul>
      {isProjectPageAvailable('workflow') ? (
        <a
          href={href.projectPage(projectId, 'workflow')}
          className="mt-5 inline-flex items-center gap-1 font-medium"
        >
          {C.workflow}
          <ArrowRightIcon size={14} />
        </a>
      ) : null}
    </Card>
  );
}
