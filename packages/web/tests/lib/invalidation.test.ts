import { describe, expect, it } from 'vitest';
import { codeHostPaths, paths } from '../../src/lib/api';
import { affectedBy } from '../../src/lib/invalidation';

describe('stream invalidation', () => {
  const ingested = affectedBy({
    kind: 'events-ingested',
    lastEventId: 5,
    sessionIds: ['s-1'],
    projectIds: ['p-1'],
  });

  it('refetches aggregates, lists, trees and details after ingestion', () => {
    for (const key of [
      paths.overview(),
      paths.sessions({ status: 'active' }),
      paths.session('s-2'),
      paths.sessionTree('s-9'),
      paths.usageSummary({ groupBy: 'day' }),
      paths.projectSessions('p-1'),
      paths.events(),
    ]) {
      expect(ingested(key)).toBe(true);
    }
  });

  it('refetches event pages only for the sessions named in the notice', () => {
    expect(ingested(paths.sessionEvents('s-1'))).toBe(true);
    expect(ingested(paths.sessionEvents('s-1', 'cur'))).toBe(true);
    expect(ingested(paths.sessionEvents('s-2'))).toBe(false);
  });

  it('never refetches health for a notice', () => {
    expect(ingested(paths.health())).toBe(false);
    const changed = affectedBy({
      kind: 'projects-changed',
      lastEventId: 5,
      sessionIds: [],
      projectIds: ['p-1'],
    });
    expect(changed(paths.health())).toBe(false);
    expect(changed(paths.candidates())).toBe(true);
  });

  it('never asks GitHub again for a notice (ADR-0025): only a screen or Check again does', () => {
    const changed = affectedBy({
      kind: 'projects-changed',
      lastEventId: 5,
      sessionIds: [],
      projectIds: ['p-1'],
    });
    for (const match of [ingested, changed]) {
      expect(match(codeHostPaths.status('p-1'))).toBe(false);
      expect(match(codeHostPaths.status('p-1').replace('/code-host', '/setup'))).toBe(true);
    }
  });
});
