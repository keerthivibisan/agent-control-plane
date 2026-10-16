import { useState } from 'react';
import { Button } from '../../components/Button';
import { ErrorNotice } from '../../components/ErrorNotice';
import { InfoTip } from '../../components/InfoTip';
import { PageHeader } from '../../components/PageHeader';
import { commitSkill, skillsPaths, skillsSchemas } from '../../lib/api';
import { SKILLS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href, navigate } from '../../lib/router';
import { useSkillAction } from './actions';
import { RefusalNotice } from './bits';
import { SkillEditor } from './SkillEditor';
import { SkillList } from './SkillList';
import type { SkillTemplate } from './templates';

const C = SKILLS_COPY;

type View =
  | { kind: 'list' }
  | { kind: 'new'; template: SkillTemplate | null }
  | { kind: 'edit'; name: string };

/** A deleted skill whose removal is not committed yet; offered on the list. */
function RemovalNotice({
  projectId,
  name,
  onDone,
}: {
  projectId: string;
  name: string;
  onDone: () => void;
}) {
  const commit = useSkillAction(projectId, commitSkill);
  return (
    <div
      role="status"
      data-testid="removal-notice"
      className="mb-4 flex flex-col gap-2 rounded-card border border-line bg-panel px-4 py-3 shadow-card"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1">{C.commit.removal(name)}</p>
        <Button
          variant="primary"
          disabled={commit.pending}
          onClick={() =>
            void commit.run(name).then((r) => {
              if (r !== null) onDone();
            })
          }
        >
          {commit.pending ? C.commit.committing : C.commit.commitRemoval}
        </Button>
      </div>
      <RefusalNotice error={commit.error} />
    </div>
  );
}

function EditView({
  projectId,
  name,
  existing,
  back,
  onDeleted,
}: {
  projectId: string;
  name: string;
  existing: readonly string[];
  back: () => void;
  onDeleted: (name: string) => void;
}) {
  const { data, error } = useApiQuery(skillsPaths.skill(projectId, name), skillsSchemas.detail);
  if (error !== null && data === undefined) {
    return error.kind === 'http' ? <RefusalNotice error={error} /> : <ErrorNotice error={error} />;
  }
  if (data === undefined) return <p className="text-dim">{C.page.loading}</p>;
  return (
    <SkillEditor
      key={name}
      projectId={projectId}
      detail={data}
      existing={existing}
      onCreated={() => undefined}
      onCancel={back}
      onDeleted={onDeleted}
    />
  );
}

/**
 * The Skills page (docs/redesign/README.md §4.3): the project's own skills in
 * `.claude/skills/<name>/SKILL.md`, a new/edit form with templates and a preview, Save and Commit,
 * and Delete when no workflow stage uses the skill. The shell mounts it at `#/p/:projectId/skills`
 * and `…/skills/:name` (`item`); opening a skill or going back updates the address, so a skill has
 * a link. "New skill" has no address of its own.
 */
export function SkillsPage({
  projectId,
  item = null,
}: {
  projectId: string;
  item?: string | null;
}) {
  const viewFor = (name: string | null): View =>
    name === null ? { kind: 'list' } : { kind: 'edit', name };
  const [view, setView] = useState<View>(viewFor(item));
  // The address changed (back button, a link, our own navigate): follow it, keeping other state.
  const [shownItem, setShownItem] = useState(item);
  if (item !== shownItem) {
    setShownItem(item);
    setView(viewFor(item));
  }
  const [removed, setRemoved] = useState<string | null>(null);
  const list = useApiQuery(skillsPaths.list(projectId), skillsSchemas.list);
  const names = (list.data ?? []).map((s) => s.name);
  const open = (name: string | null) => {
    setView(viewFor(name));
    navigate(name === null ? href.projectPage(projectId, 'skills') : href.skill(projectId, name));
  };
  const toList = () => open(null);

  const header = (
    <PageHeader
      eyebrow={
        view.kind === 'list' ? undefined : (
          <button type="button" onClick={toList} className="hover:text-ink hover:underline">
            ← {C.page.back}
          </button>
        )
      }
      title={
        <span className="inline-flex items-center gap-1.5">
          {C.page.title}
          <InfoTip tip={C.page.tip} label={C.page.title} />
        </span>
      }
      description={C.page.description}
      actions={
        view.kind === 'list' && (list.data?.length ?? 0) > 0 ? (
          <Button variant="primary" onClick={() => setView({ kind: 'new', template: null })}>
            {C.page.newSkill}
          </Button>
        ) : undefined
      }
    />
  );

  let body;
  if (view.kind === 'new') {
    body = (
      <SkillEditor
        projectId={projectId}
        template={view.template}
        existing={names}
        onCreated={(name) => open(name)}
        onCancel={toList}
        onDeleted={() => undefined}
      />
    );
  } else if (view.kind === 'edit') {
    body = (
      <EditView
        projectId={projectId}
        name={view.name}
        existing={names}
        back={toList}
        onDeleted={(name) => {
          setRemoved(name);
          toList();
        }}
      />
    );
  } else if (list.error !== null && list.data === undefined) {
    body =
      list.error.kind === 'http' ? (
        <RefusalNotice error={list.error} />
      ) : (
        <ErrorNotice error={list.error} />
      );
  } else if (list.data === undefined) {
    body = <p className="text-dim">{C.page.loading}</p>;
  } else {
    body = (
      <>
        {removed !== null ? (
          <RemovalNotice projectId={projectId} name={removed} onDone={() => setRemoved(null)} />
        ) : null}
        <SkillList
          skills={list.data}
          onOpen={(name) => open(name)}
          onNew={(template) => setView({ kind: 'new', template })}
        />
      </>
    );
  }

  return (
    <div data-testid="skills-page">
      {header}
      {body}
    </div>
  );
}
