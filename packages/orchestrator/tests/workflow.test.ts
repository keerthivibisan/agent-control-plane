import { defaultProjectWorkflow } from '@acp/core';
import type { ProjectWorkflow } from '@acp/core';
import { RunWorkflowDtoSchema } from '@acp/core/api';
import { describe, expect, it } from 'vitest';
import {
  BRANCH_RULE_LINE,
  AGENT_NOTE_LINE,
  SKILLS_PLUGIN_NAME,
  agentEvent,
  cancelRun,
  createRun,
  decideApproval,
  decidePlan,
  deriveRunWorkflow,
  leadToolCall,
  ownerChat,
  pluginSkillName,
  recordReview,
  recoverAfterRestart,
  requestPermission,
  resolveAgentModel,
  skillLine,
  stageAgentFor,
} from '../src/index.js';
import type { EngineEffect, EngineResult, RunState } from '../src/index.js';
import { LEAD, PROJECT, REGISTERED, RUN, TICKET, makeCtx, ok, refused } from './helpers.js';
import {
  PLANNER,
  WF_TIME,
  WORKER,
  approved,
  createWithWorkflow,
  finish,
  helperDone,
  merged,
  planning,
  postReview,
  submitAs,
  workflow,
} from './workflow-helpers.js';

/** Workflow snapshot, default equivalence, skills, models and live stage states (ADR-0019). */

/** The Phase 4 ticket flow, step by step; returns every step's result. */
function phase4Flow(wf: ProjectWorkflow | undefined): EngineResult<unknown>[] {
  const steps: EngineResult<unknown>[] = [];
  const step = <T>(r: EngineResult<T>): RunState => {
    steps.push(r);
    return ok(r).state;
  };
  let s = step(createWithWorkflow(wf));
  s = step(
    agentEvent(s, LEAD, { type: 'started', providerSessionId: 'sess', model: null }, makeCtx(10)),
  );
  s = step(ownerChat(s, 'Keep it small', makeCtx(20)));
  s = step(agentEvent(s, LEAD, { type: 'lead-text', text: 'Will do.' }, makeCtx(25)));
  s = step(submitAs(s, LEAD, 'p'));
  s = step(decidePlan(s, 'p-1', 'request-changes', makeCtx(40), 'Fewer steps'));
  s = step(submitAs(s, LEAD, 'q'));
  s = step(decidePlan(s, 'q-1', 'approve', makeCtx(60), 'Go'));
  s = step(
    leadToolCall(
      s,
      {
        callerAgentRunId: LEAD,
        name: 'start_agent',
        input: { role: 'UI', task: 'Add the toggle' },
        registeredProjectIds: REGISTERED,
      },
      makeCtx(70, 'w'),
    ),
  );
  s = step(
    agentEvent(s, WORKER, { type: 'started', providerSessionId: 'sw', model: null }, makeCtx(80)),
  );
  s = step(
    requestPermission(
      s,
      { agentRunId: WORKER, toolName: 'Edit', toolUseId: 't1', summary: 'Edit a.ts' },
      makeCtx(90, 'ap'),
    ),
  );
  s = step(decideApproval(s, 'ap-1', 'approve', makeCtx(100)));
  s = step(
    agentEvent(
      s,
      WORKER,
      {
        type: 'usage',
        messageId: 'm1',
        tokens: { input: 1, output: 2, cacheCreation: 0, cacheRead: 3 },
      },
      makeCtx(105),
    ),
  );
  s = step(finish(s, WORKER));
  s = step(
    leadToolCall(
      s,
      {
        callerAgentRunId: LEAD,
        name: 'request_review',
        input: {},
        registeredProjectIds: REGISTERED,
      },
      makeCtx(120),
    ),
  );
  step(recordReview(s, WORKER, 'merged', makeCtx(130)));
  return steps;
}

const withoutWorkflow = (s: RunState): RunState => {
  const copy: RunState = { ...s };
  delete copy.workflow;
  return copy;
};

describe('default workflow equals Phase 4', () => {
  it('gives the same effects, values and states at every step as a run without a workflow', () => {
    const plain = phase4Flow(undefined);
    const dflt = phase4Flow(defaultProjectWorkflow(PROJECT, WF_TIME));
    expect(dflt).toHaveLength(plain.length);
    plain.forEach((p, i) => {
      const d = dflt[i];
      if (!p.ok || d === undefined || !d.ok) throw new Error(`step ${i} refused`);
      expect(d.effects).toEqual(p.effects);
      if (i > 0) expect(d.value).toEqual(p.value);
      expect(withoutWorkflow(d.state)).toEqual(p.state);
    });
    const last = plain[plain.length - 1];
    expect(last?.ok === true && last.state.run.status).toBe('COMPLETED');
  });

  it('snapshots the workflow with the run; later edits to the input do not reach it', () => {
    const wf = workflow({ codeReview: true });
    const s = ok(createWithWorkflow(wf)).state;
    wf.stages['code-review'].enabled = false;
    expect(s.workflow?.stages['code-review'].enabled).toBe(true);
  });

  it('restarts the same way: nothing held, nothing relaunched', () => {
    const plain = ok(recoverAfterRestart(helperDone(undefined), makeCtx(9000)));
    const dflt = ok(
      recoverAfterRestart(helperDone(defaultProjectWorkflow(PROJECT, WF_TIME)), makeCtx(9000)),
    );
    expect(dflt.effects).toEqual(plain.effects);
    expect(withoutWorkflow(dflt.state)).toEqual(plain.state);
  });
});

describe('createRun with a workflow: refusals', () => {
  const base = {
    runId: RUN,
    leadAgentRunId: LEAD,
    projectId: PROJECT,
    title: 't',
    registeredProjectIds: REGISTERED,
  };

  it('refuses a workflow on a run without a ticket', () => {
    expect(refused(createRun({ ...base, workflow: workflow() }, makeCtx()))).toBe('invalid-input');
  });

  it("refuses another project's workflow or an invalid one", () => {
    const ticket = { ticketId: TICKET, leadPrompt: 'brief' };
    const other = { ...workflow(), projectId: 'other' };
    expect(refused(createRun({ ...base, ticket, workflow: other }, makeCtx()))).toBe(
      'invalid-input',
    );
    const bad = workflow({ skills: { plan: 'Not A Skill' } });
    expect(refused(createRun({ ...base, ticket, workflow: bad }, makeCtx()))).toBe('invalid-input');
  });

  it('needs a planner prompt in separate mode, and only there', () => {
    const separate = workflow({ plannerMode: 'separate' });
    expect(
      refused(
        createRun(
          { ...base, ticket: { ticketId: TICKET, leadPrompt: 'b' }, workflow: separate },
          makeCtx(),
        ),
      ),
    ).toBe('invalid-input');
    expect(
      refused(
        createRun(
          {
            ...base,
            ticket: { ticketId: TICKET, leadPrompt: 'b', plannerPrompt: '  ' },
            workflow: separate,
          },
          makeCtx(),
        ),
      ),
    ).toBe('invalid-input');
    expect(
      refused(
        createRun(
          { ...base, ticket: { ticketId: TICKET, leadPrompt: 'b', plannerPrompt: 'p' } },
          makeCtx(),
        ),
      ),
    ).toBe('invalid-input');
    expect(
      refused(
        createRun(
          {
            ...base,
            ticket: { ticketId: TICKET, leadPrompt: 'b', plannerPrompt: 'p' },
            workflow: workflow(),
          },
          makeCtx(),
        ),
      ),
    ).toBe('invalid-input');
  });
});

describe('skills and models per stage', () => {
  const startOf = (effects: readonly EngineEffect[]) => {
    const e = effects.find((x) => x.type === 'start-agent');
    if (e?.type !== 'start-agent') throw new Error('no start-agent effect');
    return e;
  };

  it('names the skill in the skills plugin, in one line, without file content', () => {
    expect(SKILLS_PLUGIN_NAME).toBe('acp-skills');
    expect(pluginSkillName('code-review')).toBe('acp-skills:code-review');
    expect(skillLine('code-review')).toBe('Use the project skill `acp-skills:code-review`.');
  });

  it('adds the lead the plan and orchestrate skills in lead mode, once each', () => {
    const wf = workflow({
      skills: { plan: 'planning', orchestrate: 'planning' },
      models: { orchestrate: 'claude-opus' },
    });
    const start = startOf(ok(createWithWorkflow(wf)).effects);
    expect(start.prompt).toBe(
      'Ticket WEB-1: plan first\n\nUse the project skill `acp-skills:planning`.',
    );
    expect(start.skills).toEqual(['planning']);
    expect(start.model).toBe('claude-opus');
  });

  it('gives the planner the plan skill and the lead the orchestrate skill in separate mode', () => {
    const wf = workflow({
      plannerMode: 'separate',
      skills: { plan: 'planning', orchestrate: 'orchestrating' },
      models: { plan: 'claude-sonnet' },
    });
    const planner = startOf(ok(createWithWorkflow(wf)).effects);
    expect(planner.agentRunId).toBe(PLANNER);
    expect(planner.skills).toEqual(['planning']);
    expect(planner.model).toBe('claude-sonnet');
    const s = ok(submitAs(planning(wf), PLANNER)).state;
    const lead = startOf(ok(decidePlan(s, 'p-1', 'approve', makeCtx(1600))).effects);
    expect(lead.skills).toEqual(['orchestrating']);
    expect(lead.prompt.endsWith('Use the project skill `acp-skills:orchestrating`.')).toBe(true);
    expect(lead.model).toBeUndefined();
  });

  it("gives helpers, the reviewer and the tester their stage's skill and model", () => {
    const wf = workflow({
      codeReview: true,
      unitTests: true,
      skills: { helpers: 'frontend', 'code-review': 'code-review', 'unit-tests': 'unit-tests' },
      models: { helpers: 'claude-haiku', 'unit-tests': 'claude-sonnet' },
    });
    const s = approved(wf);
    const worker = startOf(
      ok(
        leadToolCall(
          s,
          {
            callerAgentRunId: LEAD,
            name: 'start_agent',
            input: { role: 'UI', task: 'Add the toggle' },
            registeredProjectIds: REGISTERED,
          },
          makeCtx(2000, 'w'),
        ),
      ).effects,
    );
    expect(worker).toMatchObject({
      prompt: `Add the toggle\n\n${BRANCH_RULE_LINE}\n\n${AGENT_NOTE_LINE}\n\nUse the project skill \`acp-skills:frontend\`.`,
      skills: ['frontend'],
      model: 'claude-haiku',
    });
    const r = ok(merged(wf));
    const reviewer = startOf(r.effects);
    expect(reviewer.skills).toEqual(['code-review']);
    expect(reviewer.model).toBeUndefined();
    const t = ok(finish(ok(postReview(r.state, 'm-1')).state, 'm-1'));
    const tester = startOf(t.effects);
    expect(tester).toMatchObject({
      kind: 'tester',
      skills: ['unit-tests'],
      model: 'claude-sonnet',
    });
  });

  it('adds nothing when no stage maps a skill or a model', () => {
    const start = startOf(ok(createWithWorkflow(workflow())).effects);
    expect(start).not.toHaveProperty('skills');
    expect(start).not.toHaveProperty('model');
  });
});

describe('agent files per stage (ADR-0019 §6)', () => {
  const startOf = (effects: readonly EngineEffect[]) => {
    const e = effects.find((x) => x.type === 'start-agent');
    if (e?.type !== 'start-agent') throw new Error('no start-agent effect');
    return e;
  };

  it("names the stage's agent file on the effect, next to its skills, without changing the prompt", () => {
    const wf = workflow({
      skills: { orchestrate: 'planning' },
      agents: { orchestrate: 'lead-file' },
    });
    const start = startOf(ok(createWithWorkflow(wf)).effects);
    expect(start.agent).toBe('lead-file');
    expect(start.skills).toEqual(['planning']);
    expect(start.prompt).toBe(
      'Ticket WEB-1: plan first\n\nUse the project skill `acp-skills:planning`.',
    );
    // No stage model: the effect leaves the model to the server (file model, then project).
    expect(start).not.toHaveProperty('model');
  });

  it('gives the lead in lead mode the orchestrate file, else the plan file', () => {
    expect(stageAgentFor(workflow({ agents: { plan: 'p', orchestrate: 'o' } }), 'lead')).toBe('o');
    expect(stageAgentFor(workflow({ agents: { plan: 'p' } }), 'lead')).toBe('p');
    const separate = workflow({ plannerMode: 'separate', agents: { plan: 'p' } });
    expect(stageAgentFor(separate, 'lead')).toBeNull();
    expect(stageAgentFor(separate, 'planner')).toBe('p');
  });

  it('gives the planner, helpers, reviewer and tester their own stage file', () => {
    const wf = workflow({
      plannerMode: 'separate',
      codeReview: true,
      unitTests: true,
      agents: {
        plan: 'planner-file',
        helpers: 'helper-file',
        'code-review': 'reviewer-file',
        'unit-tests': 'tester-file',
      },
    });
    expect(startOf(ok(createWithWorkflow(wf)).effects).agent).toBe('planner-file');
    expect(stageAgentFor(wf, 'worker')).toBe('helper-file');
    expect(stageAgentFor(wf, 'reviewer')).toBe('reviewer-file');
    expect(stageAgentFor(wf, 'tester')).toBe('tester-file');
    expect(stageAgentFor(wf, 'lead')).toBeNull();
  });

  it('puts the helper file on a worker start, with the stage model when one is set', () => {
    const wf = workflow({
      agents: { helpers: 'frontend-dev' },
      models: { helpers: 'claude-haiku' },
    });
    const worker = startOf(
      ok(
        leadToolCall(
          approved(wf),
          {
            callerAgentRunId: LEAD,
            name: 'start_agent',
            input: { role: 'UI', task: 'Add the toggle' },
            registeredProjectIds: REGISTERED,
          },
          makeCtx(2000, 'w'),
        ),
      ).effects,
    );
    expect(worker).toMatchObject({ agent: 'frontend-dev', model: 'claude-haiku' });
    expect(worker.prompt).toBe(`Add the toggle\n\n${BRANCH_RULE_LINE}\n\n${AGENT_NOTE_LINE}`);
  });

  it('adds nothing without an agent file (absent or null), so the effect is unchanged', () => {
    const plain = startOf(ok(createWithWorkflow(workflow())).effects);
    expect(plain).not.toHaveProperty('agent');
    const wf = workflow();
    const withNull: ProjectWorkflow = {
      ...wf,
      stages: { ...wf.stages, orchestrate: { ...wf.stages.orchestrate, agent: null } },
    };
    expect(startOf(ok(createWithWorkflow(withNull)).effects)).toEqual(plain);
    expect(stageAgentFor(undefined, 'lead')).toBeNull();
  });

  it('resolves the model: stage > agent file > project > provider default', () => {
    expect(resolveAgentModel({ stage: 'stage-m', agentFile: 'file-m', project: 'proj-m' })).toBe(
      'stage-m',
    );
    expect(resolveAgentModel({ stage: undefined, agentFile: 'file-m', project: 'proj-m' })).toBe(
      'file-m',
    );
    expect(resolveAgentModel({ stage: null, agentFile: null, project: 'proj-m' })).toBe('proj-m');
    expect(resolveAgentModel({ stage: undefined, agentFile: undefined, project: null })).toBeNull();
    // A blank value is no choice: the next one applies.
    expect(resolveAgentModel({ stage: undefined, agentFile: '  ', project: 'proj-m' })).toBe(
      'proj-m',
    );
  });
});

describe('deriveRunWorkflow', () => {
  const states = (s: RunState, wf?: ProjectWorkflow) => {
    const dto = RunWorkflowDtoSchema.parse(deriveRunWorkflow(s, wf));
    return Object.fromEntries(dto.stages.map((x) => [x.stage, x.state]));
  };
  const ids = (s: RunState) =>
    Object.fromEntries(deriveRunWorkflow(s).stages.map((x) => [x.stage, x.agentRunIds]));

  it('lists every stage in order, with optional stages off by default', () => {
    const dto = deriveRunWorkflow(planning(undefined));
    expect(dto.runId).toBe(RUN);
    expect(dto.stages.map((x) => x.stage)).toEqual([
      'plan',
      'orchestrate',
      'helpers',
      'review',
      'code-review',
      'unit-tests',
    ]);
    expect(states(planning(undefined))).toEqual({
      plan: 'active',
      orchestrate: 'waiting',
      helpers: 'waiting',
      review: 'waiting',
      'code-review': 'off',
      'unit-tests': 'off',
    });
    // In lead mode the lead covers plan and orchestrate.
    expect(ids(planning(undefined))).toMatchObject({ plan: [LEAD], orchestrate: [LEAD] });
  });

  it('shows the plan waiting for the owner, then the helpers working', () => {
    const s = ok(submitAs(planning(undefined), LEAD)).state;
    expect(states(s).plan).toBe('needs-you');
    const w = ok(
      leadToolCall(
        approved(undefined),
        {
          callerAgentRunId: LEAD,
          name: 'start_agent',
          input: { role: 'UI', task: 'x' },
          registeredProjectIds: REGISTERED,
        },
        makeCtx(2000, 'w'),
      ),
    ).state;
    expect(states(w)).toMatchObject({ plan: 'done', orchestrate: 'active', helpers: 'active' });
    expect(ids(w).helpers).toEqual([WORKER]);
  });

  it('separate mode: the planner is the plan stage, the lead waits', () => {
    const wf = workflow({ plannerMode: 'separate' });
    const s = planning(wf);
    expect(ids(s)).toMatchObject({ plan: [PLANNER], orchestrate: [LEAD] });
    expect(states(s)).toMatchObject({ plan: 'active', orchestrate: 'waiting' });
    expect(states(approved(wf))).toMatchObject({ plan: 'done', orchestrate: 'active' });
  });

  it('shows the review needing the owner, then the post-merge stages', () => {
    const wf = workflow({ codeReview: true, unitTests: true });
    expect(states(helperDone(wf))).toMatchObject({
      helpers: 'done',
      review: 'needs-you',
      'code-review': 'waiting',
      'unit-tests': 'waiting',
    });
    const r = ok(merged(wf)).state;
    expect(states(r)).toMatchObject({
      orchestrate: 'done',
      review: 'done',
      'code-review': 'active',
      'unit-tests': 'waiting',
    });
    const t = ok(finish(ok(postReview(r, 'm-1')).state, 'm-1')).state;
    expect(states(t)).toMatchObject({ 'code-review': 'done', 'unit-tests': 'active' });
    const testerId = t.agents[t.agents.length - 1]?.id ?? '';
    const pending = ok(finish(t, testerId)).state;
    expect(states(pending)['unit-tests']).toBe('needs-you');
    const done = ok(recordReview(pending, testerId, 'merged', makeCtx(20_000))).state;
    expect(done.run.status).toBe('COMPLETED');
    expect(Object.values(states(done)).every((x) => x === 'done')).toBe(true);
  });

  it('skips the post-merge stages when nothing was merged, or the run was stopped', () => {
    const wf = workflow({ codeReview: true, unitTests: true });
    const discarded = ok(recordReview(helperDone(wf), WORKER, 'discarded', makeCtx(9000))).state;
    expect(states(discarded)).toMatchObject({ 'code-review': 'skipped', 'unit-tests': 'skipped' });
    const stopped = ok(cancelRun(approved(wf), makeCtx(3000))).state;
    expect(states(stopped)).toMatchObject({
      orchestrate: 'skipped',
      helpers: 'skipped',
      'code-review': 'skipped',
    });
  });

  it('shows a held stage as needing the owner after a restart', () => {
    const wf = workflow({ codeReview: true });
    const r = ok(recoverAfterRestart(ok(merged(wf)).state, makeCtx(11_000))).state;
    expect(states(r)['code-review']).toBe('needs-you');
  });

  it("uses the run's snapshot, or the default workflow for a run without one", () => {
    const wf = workflow({ codeReview: true });
    const s = helperDone(wf);
    expect(states(s)['code-review']).toBe('waiting');
    expect(states(helperDone(undefined))['code-review']).toBe('off');
    expect(states(s, workflow())['code-review']).toBe('off');
  });

  it('shows Phase 3 runs without a plan stage', () => {
    const s = ok(
      createRun(
        {
          runId: RUN,
          leadAgentRunId: LEAD,
          projectId: PROJECT,
          title: 't',
          registeredProjectIds: REGISTERED,
        },
        makeCtx(),
      ),
    ).state;
    expect(states(s)).toMatchObject({ plan: 'skipped', orchestrate: 'waiting' });
    expect(s.agents[0]?.stage).toBeUndefined();
  });
});
