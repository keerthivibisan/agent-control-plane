import { useState, type ReactNode } from 'react';
import type { SkillCommitResultDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { ErrorNotice } from '../../components/ErrorNotice';
import { InfoTip } from '../../components/InfoTip';
import { PageHeader } from '../../components/PageHeader';
import {
  agentsPaths,
  agentsSchemas,
  commitAgent,
  commitSkill,
  isAgentsPath,
  isSkillsPath,
  skillsPaths,
  skillsSchemas,
  type ApiClient,
  type ApiError,
} from '../../lib/api';
import { AGENTS_COPY, SKILLS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href, navigate } from '../../lib/router';
import { useSkillAction } from './actions';
import { AgentEditor } from './AgentEditor';
import { AgentList } from './AgentList';
import type { AgentTemplate } from './agent-templates';
import { RefusalNotice } from './bits';
import { SkillEditor } from './SkillEditor';
import { SkillList } from './SkillList';
import type { SkillTemplate } from './templates';

const C = SKILLS_COPY;
const A = AGENTS_COPY;

export type SkillsTabId = 'skills' | 'agents';

type View<T> =
  { kind: 'list' } | { kind: 'new'; template: T | null } | { kind: 'edit'; name: string };

/** A deleted file whose removal is not committed yet; offered on the list. */
function RemovalNotice({
  projectId,
  name,
  commitFn,
  scope,
  refusals,
  onDone,
}: {
  projectId: string;
  name: string;
  commitFn: (client: ApiClient, projectId: string, name: string) => Promise<SkillCommitResultDto>;
  scope: (projectId: string) => (key: string) => boolean;
  refusals?: Readonly<Record<string, string>>;
  onDone: () => void;
}) {
  const commit = useSkillAction(projectId, commitFn, scope);
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
      <RefusalNotice error={commit.error} refusals={refusals} />
    </div>
  );
}

function Failure({ error, refusals }: { error: ApiError; refusals?: Record<string, string> }) {
  return error.kind === 'http' ? (
    <RefusalNotice error={error} refusals={refusals} />
  ) : (
    <ErrorNotice error={error} />
  );
}

/** The row above a tab's content: a back link in the editor, else the intro and "New". */
function TabBar({ back, intro, action }: { back?: ReactNode; intro?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2">
      {back}
      {intro ? <p className="max-w-3xl flex-1 text-dim">{intro}</p> : <span className="flex-1" />}
      {action}
    </div>
  );
}

function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-caption text-dim hover:text-ink hover:underline"
    >
      ← {label}
    </button>
  );
}

function SkillDetailView({
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
  if (error !== null && data === undefined) return <Failure error={error} />;
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

/** Skills: `.claude/skills/<name>/SKILL.md`. Opening one updates the address (`…/skills/:name`). */
function SkillsTab({ projectId, item }: { projectId: string; item: string | null }) {
  const viewFor = (name: string | null): View<SkillTemplate> =>
    name === null ? { kind: 'list' } : { kind: 'edit', name };
  const [view, setView] = useState<View<SkillTemplate>>(viewFor(item));
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

  if (view.kind === 'new' || view.kind === 'edit') {
    return (
      <>
        <TabBar back={<BackLink label={C.page.back} onClick={toList} />} />
        {view.kind === 'new' ? (
          <SkillEditor
            projectId={projectId}
            template={view.template}
            existing={names}
            onCreated={(name) => open(name)}
            onCancel={toList}
            onDeleted={() => undefined}
          />
        ) : (
          <SkillDetailView
            projectId={projectId}
            name={view.name}
            existing={names}
            back={toList}
            onDeleted={(name) => {
              setRemoved(name);
              toList();
            }}
          />
        )}
      </>
    );
  }
  if (list.error !== null && list.data === undefined) return <Failure error={list.error} />;
  if (list.data === undefined) return <p className="text-dim">{C.page.loading}</p>;
  return (
    <>
      {list.data.length > 0 ? (
        <TabBar
          action={
            <Button variant="primary" onClick={() => setView({ kind: 'new', template: null })}>
              {C.page.newSkill}
            </Button>
          }
        />
      ) : null}
      {removed !== null ? (
        <RemovalNotice
          projectId={projectId}
          name={removed}
          commitFn={commitSkill}
          scope={isSkillsPath}
          onDone={() => setRemoved(null)}
        />
      ) : null}
      <SkillList
        skills={list.data}
        onOpen={(name) => open(name)}
        onNew={(template) => setView({ kind: 'new', template })}
      />
    </>
  );
}

function AgentDetailView({
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
  const { data, error } = useApiQuery(agentsPaths.agent(projectId, name), agentsSchemas.detail);
  if (error !== null && data === undefined) return <Failure error={error} refusals={A.refusals} />;
  if (data === undefined) return <p className="text-dim">{A.page.loading}</p>;
  return (
    <AgentEditor
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

/** Agents: `.claude/agents/<name>.md`. Their editor has no address of its own. */
function AgentsTab({ projectId }: { projectId: string }) {
  const [view, setView] = useState<View<AgentTemplate>>({ kind: 'list' });
  const [removed, setRemoved] = useState<string | null>(null);
  const list = useApiQuery(agentsPaths.list(projectId), agentsSchemas.list);
  const names = (list.data ?? []).map((a) => a.name);
  const toList = () => setView({ kind: 'list' });

  if (view.kind === 'new' || view.kind === 'edit') {
    return (
      <>
        <TabBar back={<BackLink label={A.page.back} onClick={toList} />} />
        {view.kind === 'new' ? (
          <AgentEditor
            projectId={projectId}
            template={view.template}
            existing={names}
            onCreated={(name) => setView({ kind: 'edit', name })}
            onCancel={toList}
            onDeleted={() => undefined}
          />
        ) : (
          <AgentDetailView
            projectId={projectId}
            name={view.name}
            existing={names}
            back={toList}
            onDeleted={(name) => {
              setRemoved(name);
              toList();
            }}
          />
        )}
      </>
    );
  }
  if (list.error !== null && list.data === undefined) {
    return <Failure error={list.error} refusals={A.refusals} />;
  }
  if (list.data === undefined) return <p className="text-dim">{A.page.loading}</p>;
  return (
    <>
      <TabBar
        intro={A.page.intro}
        action={
          list.data.length > 0 ? (
            <Button variant="primary" onClick={() => setView({ kind: 'new', template: null })}>
              {A.page.newAgent}
            </Button>
          ) : undefined
        }
      />
      {removed !== null ? (
        <RemovalNotice
          projectId={projectId}
          name={removed}
          commitFn={commitAgent}
          scope={isAgentsPath}
          refusals={A.refusals}
          onDone={() => setRemoved(null)}
        />
      ) : null}
      <AgentList
        agents={list.data}
        onOpen={(name) => setView({ kind: 'edit', name })}
        onNew={(template) => setView({ kind: 'new', template })}
      />
    </>
  );
}

const TABS: readonly { id: SkillsTabId; label: string }[] = [
  { id: 'skills', label: C.page.skillsTab },
  { id: 'agents', label: C.page.agentsTab },
];

/**
 * The Skills & Agents page (docs/redesign/README.md §4.3): the project's own skills
 * (`.claude/skills/<name>/SKILL.md`) and agent definitions (`.claude/agents/<name>.md`), each with
 * a list, New/Edit with templates and a preview, Save, Commit and Delete (ADR-0018 and its
 * amendment). The shell mounts it at `#/p/:projectId/skills`, `…/skills/:name` (`item`) and
 * `…/skills?tab=agents` (`tab`). Stage mapping is the Workflow page's job; skills only show
 * which stages use them.
 */
export function SkillsPage({
  projectId,
  item = null,
  tab = 'skills',
}: {
  projectId: string;
  item?: string | null;
  tab?: SkillsTabId;
}) {
  // An open skill is always on the Skills tab.
  const wanted: SkillsTabId = item !== null ? 'skills' : tab;
  const [current, setCurrent] = useState<SkillsTabId>(wanted);
  const [shownTab, setShownTab] = useState(wanted);
  if (wanted !== shownTab) {
    setShownTab(wanted);
    setCurrent(wanted);
  }
  const choose = (id: SkillsTabId) => {
    setCurrent(id);
    navigate(href.projectPage(projectId, 'skills', id === 'agents' ? { tab: 'agents' } : {}));
  };

  return (
    <div data-testid="skills-page">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            {C.page.title}
            <InfoTip tip={C.page.tip} label={C.page.title} />
          </span>
        }
        description={C.page.description}
      />
      <div role="tablist" aria-label={C.page.tabs} className="mb-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`skills-tab-${t.id}`}
            aria-selected={current === t.id}
            aria-controls={`skills-panel-${t.id}`}
            onClick={() => choose(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 font-medium transition-colors ${current === t.id ? 'border-accent text-ink' : 'border-transparent text-dim hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`skills-panel-${current}`} aria-labelledby={`skills-tab-${current}`}>
        {current === 'skills' ? (
          <SkillsTab projectId={projectId} item={item} />
        ) : (
          <AgentsTab projectId={projectId} />
        )}
      </div>
    </div>
  );
}
