import type { SkillSummaryDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { RelativeTime } from '../../components/RelativeTime';
import { SparkIcon } from '../../components/icons';
import { SKILLS_COPY } from '../../lib/copy';
import { ProblemList, StageChips, UncommittedBadge } from './bits';
import { SKILL_TEMPLATES, type SkillTemplate } from './templates';

const C = SKILLS_COPY;

/** One skill as a card: name, when to use it, which stages use it, and its git state. */
function SkillCard({ skill, onOpen }: { skill: SkillSummaryDto; onOpen: () => void }) {
  return (
    <li
      data-testid={`skill-card-${skill.name}`}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-panel p-5 shadow-card transition-colors hover:border-line-strong"
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent"
        >
          <SparkIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono font-semibold">
            <button
              type="button"
              onClick={onOpen}
              aria-label={C.card.open(skill.name)}
              className="text-left hover:text-accent hover:underline focus-visible:underline"
            >
              {skill.name}
            </button>
          </h2>
          <p className={`mt-0.5 line-clamp-2 ${skill.description === '' ? 'text-dim italic' : ''}`}>
            {skill.description === '' ? C.card.noDescription : skill.description}
          </p>
        </div>
        {skill.uncommitted ? <UncommittedBadge /> : null}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-caption text-dim">{C.card.usedBy}</span>
        <StageChips stages={skill.usedBy} />
      </div>
      <ProblemList problems={skill.problems} />
      <p className="mt-auto border-t border-line pt-3 text-caption text-dim">
        {C.card.lastCommitted}:{' '}
        <RelativeTime iso={skill.lastCommittedAt} fallback={C.card.neverCommitted} />
      </p>
    </li>
  );
}

export function TemplateButtons({ onPick }: { onPick: (t: SkillTemplate | null) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {SKILL_TEMPLATES.map((t) => (
        <Button key={t.id} onClick={() => onPick(t)}>
          <SparkIcon size={14} aria-hidden />
          {t.label}
        </Button>
      ))}
      <Button variant="quiet" onClick={() => onPick(null)}>
        {C.empty.blank}
      </Button>
    </div>
  );
}

export function SkillList({
  skills,
  onOpen,
  onNew,
}: {
  skills: readonly SkillSummaryDto[];
  onOpen: (name: string) => void;
  onNew: (template: SkillTemplate | null) => void;
}) {
  if (skills.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line-strong bg-panel">
        <EmptyState
          testId="skills-empty"
          icon={<SparkIcon size={22} />}
          title={C.empty.title}
          text={C.empty.text}
          action={<TemplateButtons onPick={onNew} />}
        />
      </div>
    );
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label={C.page.title}>
      {skills.map((s) => (
        <SkillCard key={s.name} skill={s} onOpen={() => onOpen(s.name)} />
      ))}
    </ul>
  );
}
