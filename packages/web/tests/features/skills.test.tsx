import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SkillDetailDto, SkillSummaryDto } from '@acp/core/api';
import { App } from '../../src/app/App';
import { SkillsPage } from '../../src/features/skills/SkillsPage';
import { parseMarkdown } from '../../src/features/skills/markdown';
import { SKILL_TEMPLATES } from '../../src/features/skills/templates';
import { createApiClient, type FetchLike } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import { CSRF } from '../fixtures/control';
import { project } from '../fixtures/dto';
import { SKILLS_PROJECT_ID, commitResult, skillDetail } from '../fixtures/skills';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

const P = `/api/projects/${SKILLS_PROJECT_ID}/skills`;

/**
 * A fake skills server that keeps state like the real one: a write is what the next GET returns,
 * a delete removes the skill, and a commit clears "uncommitted". It also records each mutation's
 * CSRF header.
 */
function server(initial: SkillDetailDto[] = [], routes: RouteTable = {}) {
  const skills = new Map(initial.map((s) => [s.name, s]));
  const summary = (d: SkillDetailDto): SkillSummaryDto => {
    const { instructions: _i, ...rest } = d;
    return rest;
  };
  const notFound = () =>
    jsonResponse(404, { error: { code: 'not_found', message: 'No such skill', requestId: 'r' } });
  /** One skill's routes, answered from the current state. */
  const perSkill = (method: string, name: string, tail: string, body: unknown): Response => {
    const current = skills.get(name);
    // Like the real server, a deleted skill's removal can still be committed.
    if (method === 'POST' && tail === '/commit' && current === undefined) {
      return jsonResponse(200, commitResult({ name }));
    }
    if (current === undefined) return notFound();
    if (method === 'GET' && tail === '') return jsonResponse(200, current);
    if (method === 'PUT' && tail === '') {
      const next = skillDetail({ ...current, ...(body as object), uncommitted: true });
      skills.set(name, next);
      return jsonResponse(200, next);
    }
    if (method === 'DELETE' && tail === '') {
      skills.delete(name);
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && tail === '/commit') {
      skills.set(name, { ...current, uncommitted: false });
      return jsonResponse(200, commitResult({ name }));
    }
    return notFound();
  };
  const base = fakeServer({
    '/api/control/token': { token: CSRF },
    [P]: () => jsonResponse(200, [...skills.values()].map(summary)),
    [`POST ${P}`]: (body: unknown) => {
      const b = body as { name: string; description: string; instructions: string };
      const created = skillDetail({ ...b, uncommitted: true, lastCommittedAt: null });
      skills.set(b.name, created);
      return jsonResponse(201, created);
    },
    ...routes,
  });
  const fetch: FetchLike = (input, init) => {
    const method = init?.method ?? 'GET';
    const key = method === 'GET' ? input : `${method} ${input}`;
    const m = /^\/api\/projects\/[^/]+\/skills\/([^/]+)(\/commit)?$/.exec(input);
    if (m === null || key in routes) return base.fetch(input, init);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    base.calls.push({ method, path: input, body });
    return Promise.resolve(perSkill(method, decodeURIComponent(m[1] ?? ''), m[2] ?? '', body));
  };
  return { fetch, calls: base.calls, skills };
}

/** Records the CSRF header of every mutation. */
function withHeaders(s: ReturnType<typeof server>) {
  const headers: (string | null)[] = [];
  const fetch: FetchLike = (input, init) => {
    if (init?.method !== undefined && init.method !== 'GET') {
      headers.push(((init.headers ?? {}) as Record<string, string>)['X-ACP-CSRF'] ?? null);
    }
    return s.fetch(input, init);
  };
  return { ...s, fetch, headers };
}

describe('Skills page', () => {
  it('shows "No skills yet" with the templates, and a template fills a new skill', async () => {
    const s = withHeaders(server());
    renderWithApi(<SkillsPage projectId={SKILLS_PROJECT_ID} />, s);
    const empty = await screen.findByTestId('skills-empty');
    expect(within(empty).getByText('No skills yet')).toBeTruthy();
    for (const t of ['Code review', 'Unit tests', 'Plan', 'Docs', 'Blank skill']) {
      expect(within(empty).getByRole('button', { name: t })).toBeTruthy();
    }
    fireEvent.click(within(empty).getByRole('button', { name: 'Code review' }));

    const editor = await screen.findByTestId('skill-editor');
    const template = SKILL_TEMPLATES[0];
    expect(within(editor).getByLabelText<HTMLInputElement>('Name').value).toBe('code-review');
    expect(within(editor).getByLabelText<HTMLTextAreaElement>('When to use it').value).toBe(
      template?.description,
    );
    expect(within(editor).getByLabelText<HTMLTextAreaElement>('Instructions').value).toBe(
      template?.instructions,
    );
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    // Saved: the page switches to the skill, uncommitted, with Commit available.
    const commitCard = await screen.findByTestId('skill-commit');
    await waitFor(() =>
      expect(
        within(commitCard).getByRole<HTMLButtonElement>('button', { name: 'Commit' }).disabled,
      ).toBe(false),
    );
    expect(screen.getAllByTestId('uncommitted-badge').length).toBeGreaterThan(0);
    const post = s.calls.find((c) => c.method === 'POST' && c.path === P);
    expect(post?.body).toEqual({
      name: 'code-review',
      description: template?.description,
      instructions: template?.instructions,
    });
    expect(s.headers).toEqual([CSRF]);
  });

  it('lists skills with used-by stage chips, git state and problems', async () => {
    const s = server([
      skillDetail({ name: 'code-review', usedBy: ['plan', 'code-review'], uncommitted: true }),
      skillDetail({
        name: 'docs',
        description: '',
        lastCommittedAt: null,
        problems: ['The front matter has no description.'],
      }),
    ]);
    renderWithApi(<SkillsPage projectId={SKILLS_PROJECT_ID} />, s);
    const review = await screen.findByTestId('skill-card-code-review');
    expect(within(review).getByText('Plan')).toBeTruthy();
    expect(within(review).getByText('Final code review')).toBeTruthy();
    expect(within(review).getByText('Uncommitted')).toBeTruthy();
    expect(within(review).getByText(/Review a finished change/)).toBeTruthy();

    const docs = screen.getByTestId('skill-card-docs');
    expect(within(docs).getByText('No description')).toBeTruthy();
    expect(within(docs).getByText('Not used by any stage')).toBeTruthy();
    expect(within(docs).getByText('Never committed')).toBeTruthy();
    expect(within(docs).getByText('The front matter has no description.')).toBeTruthy();
    expect(within(docs).queryByText('Uncommitted')).toBeNull();
    expect(screen.getByRole('button', { name: 'New skill' })).toBeTruthy();
  });

  it('edits, saves, then commits with an explanation of what Commit does', async () => {
    const s = withHeaders(server([skillDetail({ name: 'code-review' })]));
    renderWithApi(<SkillsPage projectId={SKILLS_PROJECT_ID} />, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Open skill code-review' }));
    const editor = await screen.findByTestId('skill-editor');
    expect(within(editor).getByLabelText<HTMLInputElement>('Name').disabled).toBe(true);
    const commitCard = within(editor).getByTestId('skill-commit');
    expect(commitCard.textContent).toContain(
      "only this skill's folder, on the branch you have checked out",
    );
    expect(commitCard.textContent).toContain('Everything in this skill is committed.');

    fireEvent.change(within(editor).getByLabelText('When to use it'), {
      target: { value: 'Review risky changes' },
    });
    expect(within(editor).getByText('Unsaved changes')).toBeTruthy();
    expect(commitCard.textContent).toContain('Save your changes before committing.');
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    expect(await within(editor).findByText(/Saved to your working tree/)).toBeTruthy();
    const put = s.calls.find((c) => c.method === 'PUT');
    expect(put).toMatchObject({
      path: `${P}/code-review`,
      body: { name: 'code-review', description: 'Review risky changes' },
    });

    const commit = within(commitCard).getByRole<HTMLButtonElement>('button', { name: 'Commit' });
    await waitFor(() => expect(commit.disabled).toBe(false));
    fireEvent.click(commit);
    expect(await within(commitCard).findByText('Committed abc1234 on main.')).toBeTruthy();
    expect(s.headers).toEqual([CSRF, CSRF]);
  });

  it('explains a refused commit (other files staged)', async () => {
    const s = server([skillDetail({ name: 'plan', uncommitted: true })], {
      [`POST ${P}/plan/commit`]: jsonResponse(409, {
        error: { code: 'staged_changes', message: 'Other files are staged (2).', requestId: 'r' },
      }),
    });
    renderWithApi(<SkillsPage projectId={SKILLS_PROJECT_ID} item="plan" />, s);
    const commitCard = await screen.findByTestId('skill-commit');
    fireEvent.click(within(commitCard).getByRole('button', { name: 'Commit' }));
    const alert = await within(commitCard).findByRole('alert');
    expect(alert.getAttribute('data-refusal')).toBe('staged_changes');
    expect(alert.textContent).toContain('Commit or unstage them first');
    expect(alert.textContent).toContain('Other files are staged (2).');
  });

  it('disables Delete with an explanation while a stage uses the skill', async () => {
    const s = server([skillDetail({ name: 'plan', usedBy: ['plan', 'helpers'] })]);
    renderWithApi(<SkillsPage projectId={SKILLS_PROJECT_ID} item="plan" />, s);
    const del = await screen.findByTestId('skill-delete');
    expect(
      within(del).getByRole<HTMLButtonElement>('button', { name: 'Delete skill' }).disabled,
    ).toBe(true);
    expect(del.textContent).toContain(
      'Used by Plan and Helpers. Remove it from those stages on the Workflow page',
    );
  });

  it('deletes after confirmation, then offers to commit the removal', async () => {
    const s = server([skillDetail({ name: 'docs' }), skillDetail({ name: 'plan' })]);
    renderWithApi(<SkillsPage projectId={SKILLS_PROJECT_ID} item="docs" />, s);
    fireEvent.click(
      within(await screen.findByTestId('skill-delete')).getByRole('button', {
        name: 'Delete skill',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Delete docs?' });
    expect(dialog.textContent).toContain('.claude/skills/docs/SKILL.md');
    // Cancel first: nothing is sent.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(s.calls.some((c) => c.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Delete skill' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );
    const notice = await screen.findByTestId('removal-notice');
    expect(notice.textContent).toContain('Deleted docs. Commit to record the removal in git.');
    expect(await screen.findByTestId('skill-card-plan')).toBeTruthy();
    expect(screen.queryByTestId('skill-card-docs')).toBeNull();
    fireEvent.click(within(notice).getByRole('button', { name: 'Commit removal' }));
    await waitFor(() => expect(screen.queryByTestId('removal-notice')).toBeNull());
    expect(s.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE ${P}/docs`,
      `POST ${P}/docs/commit`,
    ]);
  });

  it('checks the name and description before sending, and previews the Markdown', async () => {
    const s = server([skillDetail({ name: 'plan' })]);
    renderWithApi(<SkillsPage projectId={SKILLS_PROJECT_ID} />, s);
    fireEvent.click(await screen.findByRole('button', { name: 'New skill' }));
    const editor = await screen.findByTestId('skill-editor');
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: '../Bad' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    expect(
      await within(editor).findByText(/Use lowercase letters, digits and dashes/),
    ).toBeTruthy();
    expect(within(editor).getByText('Say when the skill should be used.')).toBeTruthy();
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'plan' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    expect(await within(editor).findByText('A skill with this name already exists.')).toBeTruthy();
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(within(editor).getByLabelText('Instructions'), {
      target: { value: '# Steps\n\n1. Read **first**\n2. Then `run`' },
    });
    expect(within(editor).getByText(/of 64 KB/)).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: 'Preview' }));
    const preview = within(editor).getByTestId('skill-preview');
    expect(within(preview).getByRole('heading', { name: 'Steps' })).toBeTruthy();
    expect(within(preview).getByText('first').tagName).toBe('STRONG');
    expect(within(preview).getByText('run').tagName).toBe('CODE');
  });

  it('shows a refusal of the whole list in plain words (not a git repository)', async () => {
    const s = server([], {
      [P]: jsonResponse(409, {
        error: { code: 'not_a_git_repo', message: 'x', requestId: 'r' },
      }),
    });
    renderWithApi(<SkillsPage projectId={SKILLS_PROJECT_ID} />, s);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The project folder is not a git repository.',
    );
  });
});

describe('Skills in the shell (#/p/:projectId/skills)', () => {
  it('opens from the sidebar address, and a skill gets its own address', async () => {
    const s = server([skillDetail({ name: 'plan' })], {
      '/api/projects': [project({ id: SKILLS_PROJECT_ID, name: 'web-app' })],
    });
    window.location.hash = `#/p/${SKILLS_PROJECT_ID}/skills`;
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Skills' }).getAttribute('aria-current')).toBe(
      'page',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open skill plan' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/p/${SKILLS_PROJECT_ID}/skills/plan`));
    expect(await screen.findByTestId('skill-editor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /All skills/ }));
    await waitFor(() => expect(window.location.hash).toBe(`#/p/${SKILLS_PROJECT_ID}/skills`));
    expect(await screen.findByTestId('skill-card-plan')).toBeTruthy();
  });

  it('opens one skill directly from its address', async () => {
    const s = server([skillDetail({ name: 'docs', usedBy: ['helpers'] })], {
      '/api/projects': [project({ id: SKILLS_PROJECT_ID, name: 'web-app' })],
    });
    window.location.hash = `#/p/${SKILLS_PROJECT_ID}/skills/docs`;
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
    const status = await screen.findByTestId('skill-status');
    expect(within(status).getByText('Helpers')).toBeTruthy();
  });
});

describe('parseMarkdown', () => {
  it('reads headings, lists, quotes, code fences and paragraphs', () => {
    expect(
      parseMarkdown(
        '# Title\n\nSome text\nwraps.\n\n- a\n- b\n\n1. one\n2. two\n\n> note\n\n```\ncode <b>\n```\n',
      ),
    ).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'paragraph', text: 'Some text wraps.' },
      { kind: 'list', ordered: false, items: ['a', 'b'] },
      { kind: 'list', ordered: true, items: ['one', 'two'] },
      { kind: 'quote', text: 'note' },
      { kind: 'code', text: 'code <b>' },
    ]);
  });
});
