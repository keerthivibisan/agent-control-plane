import { SessionStatusSchema } from '@acp/core';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ParentInfo } from '../../src/components/ParentInfo';
import { STATUS_LABELS, StatusPill } from '../../src/components/StatusPill';
import { T0, T1 } from '../fixtures/dto';

describe('StatusPill', () => {
  it('never says "completed" for any status', () => {
    for (const status of SessionStatusSchema.options) {
      const { container, unmount } = render(<StatusPill status={status} />);
      expect(container.textContent?.toLowerCase()).not.toContain('complete');
      unmount();
    }
    expect(Object.values(STATUS_LABELS).join(' ')).not.toMatch(/complete/i);
  });

  it('renders stale as "stale (no recent activity)" and ended as "ended"', () => {
    expect(render(<StatusPill status="stale" />).container.textContent).toBe(
      'stale (no recent activity)',
    );
    expect(render(<StatusPill status="ended" />).container.textContent).toBe('ended');
  });

  it('explains the derivation basis on hover', () => {
    const { container } = render(
      <StatusPill
        status={{
          value: 'ended',
          provenance: 'derived',
          basis: { lastEventAt: T0, endedAt: T1, evaluatedAt: T1 },
        }}
      />,
    );
    expect(container.firstElementChild?.getAttribute('title')).toContain('provider reported end');
  });
});

describe('ParentInfo', () => {
  it('renders an unknown parent explicitly', () => {
    const { container } = render(<ParentInfo parent={{ state: 'unknown' }} />);
    expect(container.textContent).toBe('parent: unknown');
  });

  it('renders a known parent with kind, provenance and evidence', () => {
    const { container } = render(
      <ParentInfo
        parent={{
          state: 'known',
          sessionId: 'parent-session-1',
          kind: 'subagent',
          provenance: 'observed',
          evidence: ['subagent-metadata', 'spawn-tool-use'],
        }}
      />,
    );
    expect(container.textContent).toContain('subagent');
    expect(container.textContent).toContain('observed');
    expect(container.textContent).toContain('subagent-metadata, spawn-tool-use');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('#/sessions/parent-session-1');
  });
});
