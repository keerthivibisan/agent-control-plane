import type { SkillSummaryDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { RelativeTime } from '../../components/RelativeTime';
import { SparkIcon } from '../../components/icons';
import { SKILLS_COPY } from '../../lib/copy';
import { CardRow, FileCard, FileGrid, ProblemList, StageChips, UncommittedBadge } from './bits';
import { SKILL_TEMPLATES, type SkillTemplate } from './templates';

const C = SKILLS_COPY;

/** One skill as a card: name, when to use it, which stages use it, and its git state. */
function SkillCard({
  skill,
  index,
  onOpen,
}: {
  skill: SkillSummaryDto;
  index: number;
  onOpen: () => void;
}) {
  return (
    <FileCard
      testId={`skill-card-${skill.name}`}
      index={index}
      icon={<SparkIcon size={15} />}
      name={skill.name}
      openLabel={C.card.open(skill.name)}
      onOpen={onOpen}
      description={skill.description}
      badge={skill.uncommitted ? <UncommittedBadge /> : null}
      footer={
        <>
          {C.card.lastCommitted}:{' '}
          <RelativeTime iso={skill.lastCommittedAt} fallback={C.card.neverCommitted} />
        </>
      }
    >
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        <CardRow label={C.card.usedBy}>
          <StageChips stages={skill.usedBy} nodes={skill.usedByNodes} />
        </CardRow>
      </dl>
      <ProblemList problems={skill.problems} />
    </FileCard>
  );
}

export function TemplateButtons({ onPick }: { onPick: (t: SkillTemplate | null) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {SKILL_TEMPLATES.map((t) => (
        <Button key={t.id} onClick={() => onPick(t)}>
          <SparkIcon size={14} aria-hidden className="text-accent" />
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
          icon={<SparkIcon size={20} />}
          title={C.empty.title}
          text={C.empty.text}
          action={<TemplateButtons onPick={onNew} />}
        />
      </div>
    );
  }
  return (
    <FileGrid label={C.page.title}>
      {skills.map((s, i) => (
        <SkillCard key={s.name} skill={s} index={i} onOpen={() => onOpen(s.name)} />
      ))}
    </FileGrid>
  );
}
