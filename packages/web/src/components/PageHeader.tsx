import type { ReactNode } from 'react';
import { InfoTip } from './InfoTip';

/**
 * Top of every page (DESIGN.md, "Page header"): the title, one short line saying what the page
 * shows, and the primary action on the right. Longer explanations go into `tip`, an ⓘ next to the
 * title, instead of a paragraph. Supersedes `PageHeader` in ./Panel.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  tip,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small context line above the title (e.g. a link back to a list). */
  eyebrow?: ReactNode;
  /** Plain-text explanation behind an ⓘ next to the title. */
  tip?: string;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="mb-2 text-caption text-dim">{eyebrow}</div> : null}
        <h1 className="flex items-center gap-2 text-page font-semibold tracking-tight break-words">
          <span className="min-w-0">{title}</span>
          {tip ? (
            <InfoTip tip={tip} label={typeof title === 'string' ? title : 'this page'} />
          ) : null}
        </h1>
        {description ? <p className="mt-1.5 max-w-3xl text-dim">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A heading inside a page that groups several cards ("Across your projects"): larger than a card
 * title, with an optional ⓘ and actions on the right.
 */
export function SectionHeader({
  title,
  tip,
  actions,
  id,
}: {
  title: string;
  tip?: string;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 className="flex items-center gap-1.5 text-section font-semibold tracking-tight">
        {/* The id names the section; on the text only, so the ⓘ's label isn't part of it. */}
        <span id={id}>{title}</span>
        {tip ? <InfoTip tip={tip} label={title} /> : null}
      </h2>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
