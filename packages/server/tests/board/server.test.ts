import { describe, expect, it } from 'vitest';
import { BoardDtoSchema, TicketDetailDtoSchema, TicketDtoSchema } from '@acp/core/api';
import { silentLogger } from '../../src/logger.js';
import { createFakeManagedAdapter } from '../control/fake-adapter.js';
import {
  boot,
  makeRepo,
  makeTempDir,
  registerProject,
  waitFor,
} from '../verification/control/harness.js';

/*
 * The board through `startServer` (bootstrap wiring), on an ephemeral port: a ticket started and
 * planned, then a restart. Nothing is relaunched; the plan is still there and the ticket shows
 * In review (README §6.2, ADR-0013 §7).
 */

describe('board through startServer', () => {
  it('serves the board, starts a ticket, and keeps the plan across a restart', async () => {
    const dataDir = makeTempDir('acp-board-server-');
    // Live mode over an empty temp Claude dir: demo mode rebuilds its database on every start.
    const claudeDir = makeTempDir('acp-board-claude-');
    const fake = createFakeManagedAdapter();
    const first = await boot({
      mode: 'live',
      dataDir,
      claudeDir,
      adapter: fake.adapter,
      logger: silentLogger,
    });
    let ticketId: string;
    try {
      const project = await registerProject(first, 'web-app', makeRepo());
      const created = await first.post(`/api/projects/${project.id}/tickets`, {
        title: 'Add dark mode',
      });
      expect(created.status).toBe(201);
      ticketId = TicketDtoSchema.parse(created.body).id;
      await first.post(`/api/tickets/${ticketId}/move`, { status: 'READY' });
      const started = await first.post(`/api/tickets/${ticketId}/start`, {});
      expect(started.status).toBe(200);
      const lead = await waitFor(() => fake.agents.find((a) => a.spec.kind === 'lead'), 'the lead');
      lead.started();
      await lead.callLead('submit_plan', {
        summary: 'Toggle',
        steps: [{ title: 'Build', role: 'Builder', detail: '' }],
      });
      const board = await waitFor(async () => {
        const b = BoardDtoSchema.parse(
          (await first.get(`/api/board?projectId=${project.id}`)).body,
        );
        return b.columns.find((c) => c.stage === 'PLAN_REVIEW')?.tickets[0];
      }, 'the ticket in Plan review');
      expect(board.key).toBe('WEBAPP-1');
    } finally {
      await first.server.close();
    }

    const second = await boot({
      mode: 'live',
      dataDir,
      claudeDir,
      adapter: createFakeManagedAdapter().adapter,
      logger: silentLogger,
    });
    try {
      const detail = TicketDetailDtoSchema.parse(
        (await second.get(`/api/tickets/${ticketId}`)).body,
      );
      expect(detail.currentRun?.status).toBe('NEEDS_REVIEW');
      expect(detail.ticket.stage).toBe('IN_REVIEW');
      expect(detail.plans).toMatchObject([{ version: 1, status: 'proposed', summary: 'Toggle' }]);
    } finally {
      await second.server.close();
    }
  }, 60_000);
});
