import type { WorkflowStageId } from '@acp/core';
import { useMemo, useState, type ReactNode } from 'react';
import type { NodeUseDto, SkillCommitResultDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PlusSmallIcon, SparkIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { LoadingBlock } from '../../components/Skeleton';
import { Tab, TabList, TabPanel, Tabs } from '../../components/Tabs';
import {
  agentsPaths,
  agentsSchemas,
  commitAgent,
  commitSkill,
  isAgentsPath,
  isSkillsPath,
  skillsPaths,
  skillsSchemas,
  workflowGraphPaths,
  workflowGraphSchemas,
  type ApiClient,
  type ApiError,
} from '../../lib/api';
import { AGENTS_COPY, SKILLS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href, navigate } from '../../lib/router';
import { AgentFileIcon, BackIcon, CommitIcon } from '../workflow/icons';
import { useSkillAction } from './actions';
import { AgentEditor } from './AgentEditor';
import { AgentList, type AgentUsage } from './AgentList';
import type { AgentTemplate } from './agent-templates';
import { RefusalNotice } from './bits';
import { SkillEditor } from './SkillEditor';
import { SkillList } from './SkillList';
import type { SkillTemplate } from './templates';
import { nodesUsingAgent, stagesOfNodes } from './used-by';

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
      className="mb-4 flex animate-dialog-in flex-col gap-2 rounded-card border border-warning/25 bg-warning-soft px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <CommitIcon size={16} className="shrink-0 text-warning" />
        <p className="min-w-0 flex-1">{C.commit.removal(name)}</p>
        <Button
          variant="primary"
          size="sm"
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
    <div className="mb-4 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
      {back}
      <div className="min-w-0 flex-1">
        {intro ? <p className="max-w-3xl text-dim">{intro}</p> : null}
      </div>
      {action}
    </div>
  );
}

function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-2 inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-caption font-medium text-dim transition-colors hover:bg-hover hover:text-ink"
    >
      <BackIcon size={14} />
      {label}
    </button>
  );
}

/** "New skill" / "New agent": the tab's primary action. */
function NewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="primary" onClick={onClick}>
      <PlusSmallIcon size={15} />
      {label}
    </Button>
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
  if (data === undefined) return <LoadingBlock label={C.page.loading} />;
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
  if (list.data === undefined) return <LoadingBlock label={C.page.loading} />;
  return (
    <>
      {list.data.length > 0 ? (
        <TabBar
          action={
            <NewButton
              label={C.page.newSkill}
              onClick={() => setView({ kind: 'new', template: null })}
            />
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
  usedBy,
  usedByNodes,
}: {
  projectId: string;
  name: string;
  existing: readonly string[];
  back: () => void;
  onDeleted: (name: string) => void;
  usedBy: readonly WorkflowStageId[] | undefined;
  usedByNodes: readonly NodeUseDto[] | undefined;
}) {
  const { data, error } = useApiQuery(agentsPaths.agent(projectId, name), agentsSchemas.detail);
  if (error !== null && data === undefined) return <Failure error={error} refusals={A.refusals} />;
  if (data === undefined) return <LoadingBlock label={A.page.loading} />;
  return (
    <AgentEditor
      key={name}
      projectId={projectId}
      detail={data}
      existing={existing}
      onCreated={() => undefined}
      onCancel={back}
      onDeleted={onDeleted}
      usedBy={usedBy}
      usedByNodes={usedByNodes}
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
  // ADR-0023: the blocks that use each file, from the project's graph, which answers for every
  // project (WG-F: the version 1 workflow route 409s once a graph is stored); left out while it
  // isn't known.
  const graph = useApiQuery(workflowGraphPaths.graph(projectId), workflowGraphSchemas.graph).data;
  const usage = useMemo<AgentUsage | undefined>(
    () =>
      graph === undefined
        ? undefined
        : {
            usedBy: (name) => stagesOfNodes(nodesUsingAgent(graph.graph, name)),
            usedByNodes: (name) => nodesUsingAgent(graph.graph, name),
            href: href.projectPage(projectId, 'workflow'),
          },
    [graph, projectId],
  );

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
            usedBy={usage?.usedBy(view.name)}
            usedByNodes={usage?.usedByNodes?.(view.name)}
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
  if (list.data === undefined) return <LoadingBlock label={A.page.loading} />;
  return (
    <>
      <TabBar
        intro={A.page.intro}
        action={
          list.data.length > 0 ? (
            <NewButton
              label={A.page.newAgent}
              onClick={() => setView({ kind: 'new', template: null })}
            />
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
        usage={usage}
        onOpen={(name) => setView({ kind: 'edit', name })}
        onNew={(template) => setView({ kind: 'new', template })}
      />
    </>
  );
}

const TABS: readonly { id: SkillsTabId; label: string; icon: typeof SparkIcon }[] = [
  { id: 'skills', label: C.page.skillsTab, icon: SparkIcon },
  { id: 'agents', label: C.page.agentsTab, icon: AgentFileIcon },
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
      <PageHeader title={C.page.title} tip={C.page.tip} description={C.page.description} />
      <Tabs value={current} onValueChange={choose}>
        <TabList label={C.page.tabs} className="mb-5">
          {TABS.map((t) => (
            <Tab key={t.id} value={t.id}>
              <t.icon size={15} />
              {t.label}
            </Tab>
          ))}
        </TabList>
        <TabPanel value="skills">
          <SkillsTab projectId={projectId} item={item} />
        </TabPanel>
        <TabPanel value="agents">
          <AgentsTab projectId={projectId} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
