// Contract tests for the project removal preview (ADR-0036, RM-2). Synthetic ids and paths only.
import { describe, expect, it } from 'vitest';
import { ProjectRemovalPreviewDtoSchema } from '../src/api/index.js';

const BASE = {
  projectId: 'p1',
  name: 'web',
  rootPath: '/home/user/web',
  tickets: 2,
  runs: 3,
  attachments: 1,
  activeRuns: [],
  busy: false,
  folderExists: true,
};

describe('project removal preview', () => {
  it('reads an idle preview, with no busy reason', () => {
    expect(ProjectRemovalPreviewDtoSchema.parse(BASE)).toEqual(BASE);
  });

  it('reads a busy preview listing the active runs (a ticket-less run included)', () => {
    const dto = ProjectRemovalPreviewDtoSchema.parse({
      ...BASE,
      busy: true,
      busyReason: 'active-runs',
      activeRuns: [
        {
          runId: 'r1',
          ticketId: 't1',
          ticketKey: 'WEB-1',
          ticketTitle: 'Dark mode',
          status: 'RUNNING',
        },
        { runId: 'r2', ticketId: null, ticketKey: null, ticketTitle: null, status: 'QUEUED' },
      ],
    });
    expect(dto.activeRuns.map((r) => r.runId)).toEqual(['r1', 'r2']);
  });

  it('refuses a relative root, negative counts, unknown statuses and reasons', () => {
    for (const bad of [
      { ...BASE, rootPath: 'web' },
      { ...BASE, tickets: -1 },
      { ...BASE, busyReason: 'tired' },
      {
        ...BASE,
        activeRuns: [
          { runId: 'r1', ticketId: null, ticketKey: null, ticketTitle: null, status: 'NAPPING' },
        ],
      },
    ]) {
      expect(ProjectRemovalPreviewDtoSchema.safeParse(bad).success).toBe(false);
    }
  });
});
