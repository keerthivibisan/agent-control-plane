import { branchStrategyPreset } from '@acp/core';
import type { ProjectBranchesDto } from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { codeHost } from '../../e2e/github-fixtures';
import { CSRF } from '../../e2e/review-loop-fixtures';
import { missingStartBranch } from '../../src/features/branching/branch-list';
import { MissingTargetFix } from '../../src/features/branching/Branches';
import { BranchingFields } from '../../src/features/branching/BranchingFields';
import {
  chooseStrategy,
  draftFromStrategy,
  draftToStrategy,
  sameBranching,
  validateBranching,
  type BranchingDraft,
} from '../../src/features/branching/strategy-form';
import {
  TicketBranchInputs,
  sourcePlaceholder,
  sourceWord,
} from '../../src/features/branching/TicketBranchFields';
import { startSource, type TicketBranchDraft } from '../../src/features/branching/ticket-branch';
import { ApiError, type FetchLike } from '../../src/lib/api';
import { BRANCHING_COPY, PROJECT_BRANCHES_COPY, TICKET_BRANCH_COPY } from '../../src/lib/copy';
import { project } from '../fixtures/dto';
import { PROJECT_ID } from '../fixtures/project-setup';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

/*
 * G-H (ADR-0025 §10): where ticket branches start. The project's "Start ticket branches from",
 * a ticket's "Start from", and the Start refusal for a missing start branch. The server is a fake
 * that answers as the real routes do; nothing reaches git.
 */

const C = PROJECT_BRANCHES_COPY;
const BC = BRANCHING_COPY;
const P = `/api/projects/${PROJECT_ID}`;
const BRANCHES = `${P}/branches`;
const githubFlow = branchStrategyPreset('github-flow');

function branches(names: string[]): ProjectBranchesDto {
  return {
    truncated: false,
    current: 'main',
    hasOrigin: false,
    branches: [...names].sort().map((name, i) => ({
      name,
      commit: String(i % 10).repeat(40),
      current: name === 'main',
      onOrigin: null,
    })),
  };
}

/** GET the list; POST adds the branch and answers the list (as G-F's route). */
function branchServer(start: ProjectBranchesDto) {
  let current = start;
  const posts: unknown[] = [];
  const base = fakeServer({
    '/api/control/token': { token: CSRF },
    [P]: project({ id: PROJECT_ID, name: 'web-app', rootPath: '/work/web-app' }),
    [`${P}/code-host`]: codeHost('no-remote'),
    [BRANCHES]: () => jsonResponse(200, current),
    [`POST ${BRANCHES}`]: (body: unknown) => {
      const b = body as { name: string };
      current = branches([...current.branches.map((x) => x.name), b.name]);
      return jsonResponse(201, current);
    },
  });
  const fetch: FetchLike = (input, init) => {
    if (init?.method === 'POST' && input === BRANCHES && typeof init.body === 'string') {
      posts.push(JSON.parse(init.body) as unknown);
    }
    return base.fetch(input, init);
  };
  return { fetch, calls: base.calls, posts };
}

describe('the start branch rules (pure)', () => {
  it('the strategy form: empty is the target; the target’s own name is saved as none', () => {
    const d = draftFromStrategy(githubFlow);
    expect(d.defaultSourceBranch).toBe('');
    expect(draftToStrategy(d)).toEqual({ ok: true, branching: githubFlow });
    const withSource = { ...d, defaultSourceBranch: ' release/1.0 ' };
    expect(draftToStrategy(withSource)).toEqual({
      ok: true,
      branching: { ...githubFlow, defaultSourceBranch: 'release/1.0' },
    });
    expect(draftToStrategy({ ...d, defaultSourceBranch: 'main' })).toEqual({
      ok: true,
      branching: githubFlow,
    });
    expect(validateBranching({ ...d, defaultSourceBranch: 'a b' })).toEqual({
      defaultSourceBranch: BC.errors.branch,
    });
    expect(sameBranching(d, withSource)).toBe(false);
    // Saved and read back; a preset switch keeps the owner's start branch.
    const saved = draftFromStrategy({ ...githubFlow, defaultSourceBranch: 'release/1.0' });
    expect(saved.defaultSourceBranch).toBe('release/1.0');
    expect(chooseStrategy(saved, 'git-flow').defaultSourceBranch).toBe('release/1.0');
  });

  it('a ticket’s start branch: its own, else the project’s, else none (the target)', () => {
    const strategy = { ...githubFlow, defaultSourceBranch: 'release/1.0' };
    expect(startSource({ from: 'dev' }, strategy)).toBe('dev');
    expect(startSource(undefined, strategy)).toBe('release/1.0');
    expect(startSource({ target: 'dev' }, githubFlow)).toBeNull();
    expect(sourceWord(null)).toBeNull();
    expect(sourceWord({ strategy, projectKey: 'WEB' })).toBe('release/1.0');
    expect(sourcePlaceholder({ strategy: githubFlow, projectKey: 'WEB' })).toBe(
      TICKET_BRANCH_COPY.projectDefault(TICKET_BRANCH_COPY.fromTarget),
    );
  });

  it('a refused Start names the branch it needs', () => {
    const refusal = (code: string) =>
      new ApiError({ kind: 'http', path: '/x', status: 409, code, message: 'refused' });
    const strategy = { ...githubFlow, defaultSourceBranch: 'release/1.0' };
    expect(missingStartBranch(refusal('source_branch_missing'), { from: 'rc' }, strategy)).toBe(
      'rc',
    );
    expect(missingStartBranch(refusal('source_branch_missing'), undefined, strategy)).toBe(
      'release/1.0',
    );
    expect(missingStartBranch(refusal('target_branch_missing'), undefined, strategy)).toBe('main');
    expect(missingStartBranch(refusal('managed_disabled'), undefined, strategy)).toBeNull();
    expect(missingStartBranch(null, undefined, strategy)).toBeNull();
  });
});

describe('Settings: Start ticket branches from', () => {
  function Strategy({
    initial,
    seen,
  }: {
    initial: BranchingDraft;
    seen?: (d: BranchingDraft) => void;
  }) {
    const [draft, setDraft] = useState(initial);
    return (
      <BranchingFields
        draft={draft}
        errors={validateBranching(draft)}
        onChange={(d) => {
          setDraft(d);
          seen?.(d);
        }}
        projectKey="WEB"
        projectId={PROJECT_ID}
      />
    );
  }

  it('offers "Same as the target branch" first, then the local branches', async () => {
    const server = branchServer(branches(['main', 'dev', 'release/1.0']));
    const seen = vi.fn();
    renderWithApi(<Strategy initial={draftFromStrategy(githubFlow)} seen={seen} />, server);
    const select = await screen.findByLabelText<HTMLSelectElement>(BC.sourceBranch);
    await waitFor(() => expect(select.options.length).toBe(4));
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', BC.sourceSameAsTargetNamed('main')],
      ['dev', 'dev'],
      ['main', 'main'],
      ['release/1.0', 'release/1.0'],
    ]);
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: 'release/1.0' } });
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultSourceBranch: 'release/1.0' }),
    );
    expect(screen.queryByTestId('branching-source-missing')).toBeNull();
  });

  it('keeps a saved branch the folder lacks, marked, with Create it from the target', async () => {
    const server = branchServer(branches(['main']));
    renderWithApi(
      <Strategy
        initial={draftFromStrategy({ ...githubFlow, defaultSourceBranch: 'release/2.0' })}
      />,
      server,
    );
    const note = await screen.findByTestId('branching-source-missing');
    const select = screen.getByLabelText<HTMLSelectElement>(BC.sourceBranch);
    expect(select.value).toBe('release/2.0');
    expect(select.selectedOptions[0]?.textContent).toBe(BC.sourceNotListed('release/2.0'));
    fireEvent.click(within(note).getByRole('button', { name: C.createIt }));
    fireEvent.click(
      await within(note).findByRole('button', { name: C.createFrom('release/2.0', 'main') }),
    );
    expect(await screen.findByTestId('branching-source-missing-created')).toBeTruthy();
    expect(server.posts).toEqual([{ name: 'release/2.0', from: 'main' }]);
  });

  it('is not shown in the new-project wizard (no project folder yet)', () => {
    renderWithApi(
      <BranchingFields
        draft={draftFromStrategy(githubFlow)}
        errors={{}}
        onChange={() => undefined}
        projectKey="WEB"
      />,
      branchServer(branches(['main'])),
    );
    expect(screen.queryByTestId('branching-source')).toBeNull();
  });
});

describe('a ticket’s Start from', () => {
  it('offers the local branches and creates a typed one from the target', async () => {
    const server = branchServer(branches(['main', 'dev']));
    const seen = vi.fn();
    function Ticket() {
      const [draft, setDraft] = useState<TicketBranchDraft>({ name: '', target: 'dev', from: '' });
      return (
        <TicketBranchInputs
          draft={draft}
          onChange={(d) => {
            setDraft(d);
            seen(d);
          }}
          namePlaceholder={null}
          targetPlaceholder="main"
          fromPlaceholder={TICKET_BRANCH_COPY.projectDefault('release/1.0')}
          projectId={PROJECT_ID}
          preferredBase="main"
        />
      );
    }
    renderWithApi(<Ticket />, server);
    const input = screen.getByTestId<HTMLInputElement>('ticket-branch-from-input');
    expect(input.placeholder).toBe('Project default (release/1.0)');
    expect(screen.getByLabelText(TICKET_BRANCH_COPY.from)).toBe(input);
    const listId = input.getAttribute('list') ?? '';
    await waitFor(() =>
      expect(
        [...(document.getElementById(listId)?.querySelectorAll('option') ?? [])].map(
          (o) => o.value,
        ),
      ).toEqual(['dev', 'main']),
    );
    fireEvent.change(input, { target: { value: 'release/1.1' } });
    expect(seen).toHaveBeenLastCalledWith({ name: '', target: 'dev', from: 'release/1.1' });
    const missing = await screen.findByTestId('ticket-branch-from-missing');
    // A missing start branch starts, by default, from the ticket's target.
    fireEvent.click(
      await within(missing).findByRole('button', { name: C.createFrom('release/1.1', 'dev') }),
    );
    expect(await screen.findByTestId('ticket-branch-from-missing-created')).toBeTruthy();
    expect(server.posts).toEqual([{ name: 'release/1.1', from: 'dev' }]);
  });
});

describe('the Start refusal for a missing start branch', () => {
  it('offers "Create release/2.0 from main" and starts again once', async () => {
    const server = branchServer(branches(['main']));
    const onRetry = vi.fn();
    const refusal = new ApiError({
      kind: 'http',
      path: '/api/tickets/t-1/start',
      status: 409,
      code: 'source_branch_missing',
      message:
        'The branch release/2.0, which the ticket branch starts from, does not exist in the project yet',
    });
    function Harness() {
      const [error, setError] = useState<ApiError | null>(refusal);
      return (
        <MissingTargetFix
          projectId={PROJECT_ID}
          ticketBranch={undefined}
          strategy={{ ...githubFlow, defaultSourceBranch: 'release/2.0' }}
          error={error}
          onRetry={() => {
            onRetry();
            setError(null);
          }}
        />
      );
    }
    renderWithApi(<Harness />, server);
    const fix = await screen.findByTestId('start-fix');
    expect(fix.dataset.kind).toBe('source');
    expect(fix.dataset.target).toBe('release/2.0');
    expect(fix.textContent).toContain(C.sourceMissing('release/2.0'));
    fireEvent.click(
      await within(fix).findByRole('button', { name: C.createFrom('release/2.0', 'main') }),
    );
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    expect(server.posts).toEqual([{ name: 'release/2.0', from: 'main' }]);
  });
});
