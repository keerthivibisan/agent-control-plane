import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildFamily, type FamilyMember } from '../../src/features/sessions/family';
import { FamilyTree } from '../../src/features/sessions/FamilyTree';
import { edge, session, T0, T1, T2, tree } from '../fixtures/dto';

const root = session({ id: 'root', title: 'Main', childCount: 2, firstSeenAt: T0 });
const late = session({ id: 'b', agentType: 'Plan', providerAgentId: 'ag-b', firstSeenAt: T2 });
const early = session({
  id: 'a',
  agentType: 'Explore',
  providerAgentId: 'ag-a',
  childCount: 1,
  firstSeenAt: T1,
});
const nested = session({ id: 'n', agentType: 'Review', providerAgentId: 'ag-n', firstSeenAt: T2 });
const fork = session({ id: 'fork', title: 'Main, continued', firstSeenAt: T2 });
// Same provider session id as the root, but no edge: it must not be nested anywhere.
const lookalike = session({
  id: 'look',
  providerSessionId: root.providerSessionId,
  providerAgentId: 'ag-x',
});

const t = tree(
  'root',
  [root, late, early, nested, fork, lookalike],
  [edge('root', 'b'), edge('root', 'a'), edge('a', 'n'), edge('root', 'fork', 'continuation')],
);

const shape = (m: FamilyMember): unknown => ({
  id: m.session.id,
  noKnownParent: m.noKnownParent,
  helpers: m.helpers.map(shape),
  continuedAs: m.continuedAs.map(shape),
});

describe('buildFamily', () => {
  it('nests helpers in start order and keeps continuations apart, only from edges', () => {
    expect(buildFamily(t).map(shape)).toEqual([
      {
        id: 'root',
        noKnownParent: true,
        helpers: [
          {
            id: 'a',
            noKnownParent: false,
            helpers: [{ id: 'n', noKnownParent: false, helpers: [], continuedAs: [] }],
            continuedAs: [],
          },
          { id: 'b', noKnownParent: false, helpers: [], continuedAs: [] },
        ],
        continuedAs: [{ id: 'fork', noKnownParent: false, helpers: [], continuedAs: [] }],
      },
      { id: 'look', noKnownParent: true, helpers: [], continuedAs: [] },
    ]);
  });

  it('drops edges to sessions the tree does not include, and survives cycles', () => {
    const f = buildFamily(
      tree('root', [root, early], [edge('root', 'a'), edge('a', 'root'), edge('ghost', 'a')]),
    );
    const ids: string[] = [];
    const walk = (m: FamilyMember) => {
      ids.push(m.session.id);
      [...m.helpers, ...m.continuedAs].forEach(walk);
    };
    f.forEach(walk);
    expect(ids.sort()).toEqual(['a', 'root']);
  });
});

describe('FamilyTree', () => {
  it('reads top-down with names, statuses, tokens with units and an explicit unknown parent', () => {
    render(<FamilyTree tree={t} currentId="a" />);
    const top = screen.getByTestId('family-member-root');
    expect(within(top).getByRole('link', { name: 'Main' }).getAttribute('href')).toBe(
      '#/sessions/root',
    );
    expect(top.textContent).toContain('1,200 input tokens');
    expect(top.textContent).toContain('3,400 output tokens');
    expect(within(top).getByTestId('family-no-known-parent').textContent).toBe('No known parent');
    expect(top.querySelector('[data-status]')?.textContent).toBe('Running');

    const current = screen.getByTestId('family-member-a');
    expect(current.getAttribute('data-current')).toBe('true');
    expect(within(current).getByText('This session')).toBeTruthy();
    expect(within(current).getByRole('link', { name: 'Helper agent: Explore' })).toBeTruthy();
    expect(within(current).queryByTestId('family-no-known-parent')).toBeNull();

    const helpers = screen.getByRole('list', { name: 'Helper agents: Main' });
    expect(within(helpers).getByTestId('family-member-n')).toBeTruthy();
    const continued = screen.getByTestId('family-continued-as');
    expect(continued.textContent).toContain('Continued as');
    expect(within(continued).getByTestId('family-member-fork')).toBeTruthy();
    expect(screen.queryByText(/direct|in\/out/i)).toBeNull();
  });
});
