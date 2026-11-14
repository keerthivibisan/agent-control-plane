import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  GRAPH_MUTATIONS_V3,
  WorkflowGraphV3Schema,
  approvalsOf,
  createGraphRng,
  deriveRoles,
  generateValidGraphV3,
  isGraphRunnable,
  validateWorkflowGraphV3,
  type ValidateGraphContext,
  type WorkflowGraphV3,
} from '@acp/core';
import {
  TicketDetailDtoSchema,
  ValidateWorkflowGraphResultDtoSchema,
  WorkflowGraphDtoSchema,
} from '@acp/core/api';
import { createRedesignRepositories } from '@acp/db';
import { setupBoard } from '../board/helpers.js';

/*
 * The API fuzz (docs/history/workflow-graph/README.md "Graph correctness", layer 3, server part;
 * WG-C; version 3 since AR-4, ADR-0037): core's seeded version 3 generator (researchers, several
 * planners, fan-outs, custom and labelled arrows) and mutants through the real routes.
 * - Every valid generated graph PUTs 200 and a ticket starts on it (fake managed adapter).
 * - Every mutant PUTs 422 `workflow_invalid`, and a run start refuses it with 409 when it is stored
 *   directly in the database (as an older or hand-edited row could be).
 * - The server's verdict and issues always equal `validateWorkflowGraphV3`'s for the same context.
 * Fixed seeds, so a failure names the seed that reproduces it. Synthetic graphs only.
 */

const VALID_SEEDS = Array.from({ length: 50 }, (_, i) => 1000 + i);
const MUTANT_BASE_SEEDS = Array.from({ length: 12 }, (_, i) => 5000 + i * 37);

type Board = Awaited<ReturnType<typeof setupBoard>>;

async function context(s: Board): Promise<ValidateGraphContext> {
  const setup = WorkflowGraphDtoSchema.parse(
    (await s.get(`/api/projects/${s.project.id}/workflow-graph`)).body,
  ).setup;
  return {
    skills: [],
    agents: [],
    maxConcurrentHelpers: setup.maxConcurrentHelpers,
    projectMode: approvalsOf(setup).mode,
  };
}

describe('API fuzz: generated graphs and their mutants (layer 3)', () => {
  it('every valid generated graph saves (200) and a ticket starts on it', async () => {
    const s = await setupBoard();
    const ctx = await context(s);
    const path = `/api/projects/${s.project.id}/workflow-graph`;
    const failures: string[] = [];
    for (const seed of VALID_SEEDS) {
      const graph = generateValidGraphV3(seed);
      const expected = validateWorkflowGraphV3(graph, ctx);
      expect(isGraphRunnable(expected), `seed ${seed}: the generator made an invalid graph`).toBe(
        true,
      );
      const put = await s.send('put', path, { graph });
      if (put.status !== 200) {
        failures.push(`seed ${seed}: PUT ${put.status}`);
        continue;
      }
      const dto = WorkflowGraphDtoSchema.parse(put.body);
      if (!isDeepStrictEqual(dto.issues, expected)) {
        failures.push(`seed ${seed}: PUT issues differ from the validator's`);
      }
      const ticket = await s.createTicket(`Fuzz ${seed}`);
      await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
      const started = await s.post(`/api/tickets/${ticket.id}/start`);
      if (started.status !== 200) {
        failures.push(`seed ${seed}: start ${started.status}`);
        continue;
      }
      await s.settle();
      const runId = TicketDetailDtoSchema.parse(started.body).currentRun?.id ?? '';
      const snapshot = createRedesignRepositories(s.db).runAudit.getRunSnapshot(runId);
      // Key order aside (the snapshot is parsed with the schema), the same graph.
      if (!isDeepStrictEqual(snapshot?.graph, WorkflowGraphV3Schema.parse(graph))) {
        failures.push(`seed ${seed}: the run did not snapshot the graph`);
      }
      // The run graph is the snapshot, labels and all.
      const runGraph = (await s.get(`/api/runs/${runId}/workflow-graph`)).body as {
        graph?: unknown;
      };
      if (!isDeepStrictEqual(runGraph.graph, WorkflowGraphV3Schema.parse(graph))) {
        failures.push(`seed ${seed}: the run graph is not the snapshot`);
      }
      // The first agent is a researcher (research before planning), else the graph's planner
      // when it has one, else the lead.
      const first = s.fake.agents.at(-1)?.spec.kind;
      const roles = [...deriveRoles(graph).values()].flatMap((r) => (r.ok ? [r.role.role] : []));
      const planner = roles.includes('planner');
      const allowed = [
        planner ? 'planner' : 'lead',
        ...(roles.includes('researcher') ? ['researcher'] : []),
      ];
      if (first === undefined || !allowed.includes(first)) {
        failures.push(`seed ${seed}: started a ${first ?? 'nothing'} first`);
      }
      expect((await s.post(`/api/runs/${runId}/stop`)).status).toBe(200);
      await s.settle();
    }
    expect(failures).toEqual([]);
  }, 180_000);

  it('every mutant is refused by PUT (422) and by a run start (409); the verdicts match the validator', async () => {
    const s = await setupBoard();
    const ctx = await context(s);
    const path = `/api/projects/${s.project.id}/workflow-graph`;
    const ticket = await s.createTicket('Fuzz mutants');
    await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
    const repo = createRedesignRepositories(s.db).workflow;
    const failures: string[] = [];
    const applied = new Set<string>();
    let cases = 0;
    for (const seed of MUTANT_BASE_SEEDS) {
      const base = generateValidGraphV3(seed);
      const rng = createGraphRng(seed * 7919);
      for (const mutation of GRAPH_MUTATIONS_V3) {
        const mutant: WorkflowGraphV3 | null = mutation.apply(base, rng);
        if (mutant === null) continue;
        const label = `seed ${seed}, "${mutation.name}"`;
        applied.add(mutation.name);
        cases++;
        // Mutants keep the shape (the schema's own refusals never reach the validator).
        expect(WorkflowGraphV3Schema.safeParse(mutant).success, label).toBe(true);
        const expected = validateWorkflowGraphV3(mutant, ctx);

        const validated = await s.post(`${path}/validate`, { graph: mutant });
        const verdict = ValidateWorkflowGraphResultDtoSchema.parse(validated.body);
        if (verdict.ok || !isDeepStrictEqual(verdict.issues, expected)) {
          failures.push(`${label}: validate answered ok=${String(verdict.ok)}`);
        }
        if (!expected.some((i) => i.code === mutation.expectedCode && i.severity === 'error')) {
          failures.push(`${label}: no ${mutation.expectedCode} error`);
        }

        const put = await s.send('put', path, { graph: mutant });
        const code = (put.body as { error?: { code?: string } }).error?.code;
        if (put.status !== 422 || code !== 'workflow_invalid') {
          failures.push(`${label}: PUT ${put.status} ${code ?? ''}`);
        }

        repo.putGraph(s.project.id, mutant);
        const started = await s.post(`/api/tickets/${ticket.id}/start`);
        const startCode = (started.body as { error?: { code?: string } }).error?.code;
        if (started.status !== 409 || startCode !== 'workflow_invalid') {
          failures.push(`${label}: start ${started.status} ${startCode ?? ''}`);
          await s.settle();
        }
      }
    }
    expect(failures).toEqual([]);
    // Version 3 has fewer mutation kinds than version 2 had (12 seeds give about 130 cases).
    expect(cases).toBeGreaterThan(100);
    // Most mutation kinds apply to these bases; the core suite proves every one applies somewhere.
    expect(applied.size).toBeGreaterThan(GRAPH_MUTATIONS_V3.length / 2);
    // Nothing was ever started on a mutant.
    expect(s.fake.agents).toEqual([]);
    expect((await s.detail(ticket.id)).runs).toEqual([]);
  }, 180_000);
});
