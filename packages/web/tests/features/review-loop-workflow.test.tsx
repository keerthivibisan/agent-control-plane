import {
  CommandPatternSchema,
  defaultProjectWorkflow,
  FORBIDDEN_ALLOWLIST_COMMANDS,
  MAX_COMMAND_PATTERNS,
  type CommandPattern,
} from '@acp/core';
import { WorkflowGraphDtoSchema } from '@acp/core/api';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  WF_CSRF,
  WF_PROJECT_ID,
  graphDto,
  setupFixture,
  SKILLS,
} from '../../e2e/workflow-fixtures';
import { setupRequest, limitsDraft } from '../../src/features/workflow/draft';
import { buildWorkflowGraph, type SetupShape } from '../../src/features/workflow/graph';
import { WorkflowPage } from '../../src/features/workflow/WorkflowPage';
import { allowlistFor, checkCommand, startRequest } from '../../src/features/review-loop/logic';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

/*
 * RL-D (ADR-0021): the Workflow page's Approvals editor (in its Project defaults card since WG-D),
 * the version 1 graph's review-loop additions (the ticket page's live graph), and the pure rules
 * behind them. Fixtures are synthetic.
 */

beforeAll(() => {
  if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
    class Matrix {
      m22: number;
      constructor(transform?: string) {
        const scale = /scale\(([\d.]+)\)/.exec(transform ?? '')?.[1];
        this.m22 = scale === undefined ? 1 : Number(scale);
      }
    }
    Object.assign(globalThis, { DOMMatrixReadOnly: Matrix });
  }
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 });
  }
  Object.assign(SVGElement.prototype, {
    getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
});

const BASE = `/api/projects/${WF_PROJECT_ID}`;
const GRAPH = `${BASE}/workflow-graph`;
const SETUP = `${BASE}/setup`;

/** The Workflow page on the graph DTO; the approvals live in its Project defaults card (WG-D). */
function render(initial: unknown = graphDto({ setup: setupFixture() })) {
  let current = WorkflowGraphDtoSchema.parse(initial);
  const s = fakeServer({
    '/api/control/token': { token: WF_CSRF },
    [GRAPH]: () => jsonResponse(200, current),
    [`PUT ${SETUP}`]: (body: unknown) => {
      current = { ...current, setup: { ...current.setup, ...(body as object) } };
      return jsonResponse(200, current.setup);
    },
  });
  renderWithApi(<WorkflowPage projectId={WF_PROJECT_ID} />, s);
  return s;
}

const panel = () => screen.getByTestId('project-defaults');
const open = async () => {
  await screen.findByTestId('project-defaults');
};
const saveDefaults = () =>
  fireEvent.click(within(panel()).getByRole('button', { name: 'Save project defaults' }));
const puts = (s: ReturnType<typeof render>, path: string) =>
  s.calls.filter((c) => c.method === 'PUT' && c.path === path);

describe('checkCommand: the allowlist editor validates with core’s CommandPatternSchema', () => {
  const none: CommandPattern[] = [];

  it('accepts plain commands, exact or with any arguments', () => {
    expect(checkCommand('  npm   test ', 'exact', none)).toEqual({
      ok: true,
      pattern: { argv: ['npm', 'test'], match: 'exact' },
    });
    expect(checkCommand('mvn -q verify', 'prefix', none)).toMatchObject({ ok: true });
    expect(checkCommand('git status', 'exact', none)).toMatchObject({ ok: true });
  });

  it.each([
    ['npm test; rm -rf .', '“test;”'],
    ['npm test && curl x', '“&&”'],
    ['echo $HOME', '“$HOME”'],
    ['cat a|b', '“a|b”'],
    ['npm "test"', '“"test"”'],
  ])('refuses metacharacters in words: %s', (cmd, quoted) => {
    const r = checkCommand(cmd, 'exact', none);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(quoted);
    if (!r.ok) expect(r.error).toContain('only letters, digits');
  });

  it('refuses absolute paths and ..', () => {
    const abs = checkCommand('node /etc/passwd', 'exact', none);
    const up = checkCommand('node ../x.js', 'exact', none);
    const opt = checkCommand('npm --prefix=/tmp test', 'exact', none);
    for (const r of [abs, up, opt]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('no absolute paths');
    }
  });

  it.each(['sh', 'bash', 'env', 'sudo', 'xargs', 'curl', 'ssh'])(
    'refuses %s, which runs other commands or reaches the network',
    (cmd) => {
      expect(FORBIDDEN_ALLOWLIST_COMMANDS).toContain(cmd);
      const r = checkCommand(`${cmd} x`, 'prefix', none);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('cannot be allowed');
    },
  );

  it('git needs a read-only subcommand and no repository options', () => {
    const push = checkCommand('git push', 'prefix', none);
    expect(push.ok).toBe(false);
    if (!push.ok) expect(push.error).toContain('git needs a read-only subcommand');
    const dashC = checkCommand('git -C x status', 'exact', none);
    expect(dashC.ok).toBe(false);
    expect(checkCommand('git diff', 'prefix', none)).toMatchObject({ ok: true });
  });

  it('refuses a bare path as the command, too many words, an empty line and duplicates', () => {
    expect(checkCommand('./run.sh', 'exact', none)).toMatchObject({ ok: false });
    expect(checkCommand('a b c d e f g h i', 'exact', none)).toEqual({
      ok: false,
      error: 'Use at most 8 words.',
    });
    expect(checkCommand('   ', 'exact', none)).toEqual({
      ok: false,
      error: 'Type a command first.',
    });
    const list = [{ argv: ['npm', 'test'], match: 'exact' as const }];
    expect(checkCommand('npm test', 'exact', list)).toEqual({
      ok: false,
      error: 'This command is already in the list.',
    });
    // The same words as a prefix are a different entry.
    expect(checkCommand('npm test', 'prefix', list)).toMatchObject({ ok: true });
  });

  it('stops at the list limit', () => {
    const full = Array.from({ length: MAX_COMMAND_PATTERNS }, (_, i) => ({
      argv: ['make', `t${i}`],
      match: 'exact' as const,
    }));
    expect(checkCommand('npm test', 'exact', full)).toEqual({
      ok: false,
      error: `At most ${MAX_COMMAND_PATTERNS} commands. Remove one first.`,
    });
  });

  it('every pattern it accepts is one the server’s schema accepts', () => {
    for (const cmd of ['npm test', 'pnpm -r build', 'git log', 'make lint', 'cargo test --all']) {
      const r = checkCommand(cmd, 'prefix', none);
      expect(r.ok).toBe(true);
      if (r.ok) expect(CommandPatternSchema.safeParse(r.pattern).success).toBe(true);
    }
  });
});

describe('approvals in the setup request', () => {
  it('the legacy allowlist follows the mode', () => {
    expect(allowlistFor('manual')).toEqual({ editInOwnWorktree: false, runHarnessChecks: false });
    expect(allowlistFor('auto-edits')).toEqual({ editInOwnWorktree: true, runHarnessChecks: true });
    expect(allowlistFor('auto')).toEqual({ editInOwnWorktree: true, runHarnessChecks: true });
  });

  it('an untouched setup from before ADR-0021 is sent as it was, without approvals', () => {
    const setup = setupFixture() as never;
    const r = setupRequest(setup, limitsDraft(setup));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.approvals).toBeUndefined();
      expect(r.request.allowlist).toEqual({ editInOwnWorktree: true, runHarnessChecks: false });
    }
  });

  it('a setup with approvals always sends them, without the legacy allowlist (RL-V)', () => {
    const setup = setupFixture({
      approvals: { mode: 'auto', commands: [{ argv: ['npm', 'test'], match: 'exact' }] },
    }) as never;
    const r = setupRequest(setup, limitsDraft(setup));
    expect(r.ok && r.request).toMatchObject({
      approvals: { mode: 'auto', commands: [{ argv: ['npm', 'test'], match: 'exact' }] },
    });
    expect(r.ok && 'allowlist' in r.request).toBe(false);
  });
});

describe('startRequest: only what differs from the project', () => {
  const defaults = { approvalMode: 'auto-edits', reviewer: 'agent', maxReworkRounds: 2 } as const;

  it('no change sends an empty body (the run uses the project’s settings)', () => {
    expect(startRequest(defaults, defaults)).toEqual({});
  });

  it('sends each override on its own', () => {
    expect(startRequest({ ...defaults, approvalMode: 'manual' }, defaults)).toEqual({
      approvalMode: 'manual',
    });
    expect(
      startRequest({ approvalMode: 'auto', reviewer: 'lead', maxReworkRounds: 0 }, defaults),
    ).toEqual({ approvalMode: 'auto', reviewer: 'lead', maxReworkRounds: 0 });
  });
});

describe('Workflow page: Approvals (Project defaults)', () => {
  it('replaces the pre-approved actions with the four modes and their sentences', async () => {
    render();
    await open();
    const editor = within(panel()).getByTestId('approvals-editor');
    expect(within(panel()).queryByText('Pre-approved actions')).toBeNull();
    expect(within(panel()).getByRole('heading', { name: 'Approvals' })).toBeTruthy();
    const radios = within(editor).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    // Edits only, before ADR-0021, maps to Manual (a legacy setup is never widened).
    expect(within(editor).getByLabelText<HTMLInputElement>(/^Manual/).checked).toBe(true);
    expect(within(editor).getByText(/every edit and every command waits for you/)).toBeTruthy();
    expect(within(editor).getByLabelText(/Auto edits \(recommended\)/)).toBeTruthy();
    expect(within(editor).queryByTestId('approvals-warning')).toBeNull();
    expect(within(editor).queryByTestId('command-list')).toBeNull();
  });

  it('Auto edits shows the plain warning; Auto adds the command list', async () => {
    render();
    await open();
    const editor = within(panel()).getByTestId('approvals-editor');
    fireEvent.click(within(editor).getByLabelText(/^Auto edits/));
    expect(within(editor).getByTestId('approvals-warning').textContent).toContain(
      'with your user’s permissions',
    );
    expect(within(editor).queryByTestId('command-list')).toBeNull();
    fireEvent.click(within(editor).getByLabelText(/^AutoLike Auto edits/));
    expect(within(editor).getByTestId('approvals-warning')).toBeTruthy();
    expect(within(editor).getByTestId('command-list')).toBeTruthy();
  });

  it('Full auto shows its own honest warning, no command list, and saves the mode (ADR-0022)', async () => {
    const s = render();
    await open();
    const editor = within(panel()).getByTestId('approvals-editor');
    fireEvent.click(within(editor).getByLabelText(/^Full auto/));
    expect(within(editor).getByText(/Nothing asks you during the run/)).toBeTruthy();
    expect(within(editor).getByTestId('full-auto-warning').textContent).toContain(
      'it can still make mistakes — you review everything once in the final merge',
    );
    expect(within(editor).queryByTestId('approvals-warning')).toBeNull();
    expect(within(editor).queryByTestId('command-list')).toBeNull();
    saveDefaults();
    await within(panel()).findByTestId('defaults-saved');
    expect(puts(s, SETUP)[0]?.body).toMatchObject({ approvals: { mode: 'full-auto' } });
  });

  it('refuses a command inline, adds valid ones, removes one, and saves the approvals', async () => {
    const s = render();
    await open();
    const editor = within(panel()).getByTestId('approvals-editor');
    fireEvent.click(within(editor).getByLabelText(/^AutoLike Auto edits/));
    const input = within(editor).getByRole('textbox', { name: 'Command' });

    fireEvent.change(input, { target: { value: 'npm test && rm -rf .' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Add command' }));
    expect(within(editor).getByRole('alert').textContent).toContain('“&&” can’t be used');
    expect(input.getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(input, { target: { value: 'git push origin' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(editor).getByRole('alert').textContent).toContain(
      'git needs a read-only subcommand',
    );

    fireEvent.change(input, { target: { value: 'npm test' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(editor).queryByRole('alert')).toBeNull();
    fireEvent.change(input, { target: { value: 'mvn' } });
    fireEvent.change(within(editor).getByRole('combobox', { name: 'How it matches' }), {
      target: { value: 'prefix' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Add command' }));
    fireEvent.change(input, { target: { value: 'make lint' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Add command' }));

    const list = within(editor).getByRole('list', { name: 'Allowed commands' });
    expect(
      within(list)
        .getAllByTestId('command-row')
        .map((r) => r.textContent),
    ).toEqual([
      'npm testExact',
      'mvn+ any arguments',
      // The match choice stays as picked for the next command.
      'make lint+ any arguments',
    ]);
    fireEvent.click(within(list).getByRole('button', { name: 'Remove make lint' }));
    expect(within(list).getAllByTestId('command-row')).toHaveLength(2);

    saveDefaults();
    await within(panel()).findByTestId('defaults-saved');
    expect(puts(s, GRAPH)).toHaveLength(0);
    // RL-V: no legacy allowlist with the approvals (the server keeps it in step).
    expect(puts(s, SETUP)[0]?.body).not.toHaveProperty('allowlist');
    expect(puts(s, SETUP)[0]?.body).toMatchObject({
      approvals: {
        mode: 'auto',
        commands: [
          { argv: ['npm', 'test'], match: 'exact' },
          { argv: ['mvn'], match: 'prefix' },
        ],
      },
    });
  });

  it('Manual saves with nothing pre-approved; a kept list says it is unused', async () => {
    const s = render({
      ...graphDto(),
      setup: setupFixture({
        approvals: { mode: 'auto', commands: [{ argv: ['npm', 'test'], match: 'exact' }] },
      }),
    });
    await open();
    const editor = within(panel()).getByTestId('approvals-editor');
    fireEvent.click(within(editor).getByLabelText(/^Manual/));
    expect(within(editor).getByText('Kept for Auto mode; not used in this mode.')).toBeTruthy();
    saveDefaults();
    await within(panel()).findByTestId('defaults-saved');
    expect(puts(s, SETUP)[0]?.body).not.toHaveProperty('allowlist');
    expect(puts(s, SETUP)[0]?.body).toMatchObject({
      approvals: { mode: 'manual', commands: [{ argv: ['npm', 'test'], match: 'exact' }] },
    });
  });
});

describe('the graph’s review-loop additions', () => {
  const setup: SetupShape = {
    maxConcurrentHelpers: 2,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: 500_000,
    model: null,
    allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
  };
  const workflow = defaultProjectWorkflow('p-1', '2026-10-16T09:00:00.000Z');
  const loop = { reviewer: 'agent' as const, maxReworkRounds: 2, reworkLabel: 'Rework ×1' };

  it('without the loop, the graph is unchanged (a legacy run)', () => {
    const g = buildWorkflowGraph(workflow, setup, [...SKILLS]);
    expect(g.nodes.map((n) => n.id)).not.toContain('owner-merge');
    expect(g.edges.map((e) => e.id)).not.toContain('loop:review->helpers');
    expect(g.nodes.find((n) => n.id === 'review')?.data).toEqual({
      stage: 'review',
      requireChecks: true,
    });
  });

  it('adds the owner’s merge before Done, Done under it, and the rework loop to Helpers', () => {
    const plain = buildWorkflowGraph(workflow, setup);
    const g = buildWorkflowGraph(workflow, setup, undefined, undefined, undefined, loop);
    const ids = g.nodes.map((n) => n.id);
    expect(ids.slice(-2)).toEqual(['owner-merge', 'done']);
    const gate = g.nodes.find((n) => n.id === 'owner-merge');
    const done = g.nodes.find((n) => n.id === 'done');
    expect(gate?.data).toEqual({ gate: 'owner-merge' });
    expect((done?.position.y ?? 0) > (gate?.position.y ?? 0)).toBe(true);
    expect(g.height).toBeGreaterThan(plain.height);
    expect(g.edges.find((e) => e.id === 'loop:review->helpers')).toMatchObject({
      sourceHandle: 'out-top-loop',
      targetHandle: 'in-top',
      label: 'Rework ×1',
    });
    expect(g.edges.find((e) => e.id === 'flow:owner-merge->done')).toMatchObject({
      sourceHandle: 'out-bottom',
      targetHandle: 'in-top',
    });
    // Both optional stages off: the bypass now ends at the owner's merge.
    expect(
      g.edges.filter((e) => e.data?.kind === 'bypass').map((e) => `${e.source}->${e.target}`),
    ).toEqual(['review->owner-merge']);
    expect(g.nodes.find((n) => n.id === 'review')?.data).toMatchObject({
      loop: { reviewer: 'agent', maxReworkRounds: 2 },
    });
  });

  it('a bypass along the last row comes into the owner’s merge from the left', () => {
    const w = defaultProjectWorkflow('p-1', '2026-10-16T09:00:00.000Z');
    w.stages['code-review'].enabled = true;
    const g = buildWorkflowGraph(w, setup, undefined, undefined, undefined, loop);
    expect(g.edges.find((e) => e.data?.kind === 'bypass')).toMatchObject({
      source: 'code-review',
      target: 'owner-merge',
      sourceHandle: 'out-bottom',
      targetHandle: 'in-left',
    });
  });
});
