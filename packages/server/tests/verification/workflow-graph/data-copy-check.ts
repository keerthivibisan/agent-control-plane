import { appendFileSync, existsSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { ManagedAgentEvent, ManagedExecutionAdapter } from '@acp/core';
import {
  ProjectDtoSchema,
  RunDetailDtoSchema,
  RunSummaryDtoSchema,
  RunWorkflowGraphDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  WorkflowGraphDtoSchema,
} from '@acp/core/api';
import { startServer } from '../../../src/bootstrap.js';
import { loadConfig } from '../../../src/config.js';
import { createLogger } from '../../../src/logger.js';
import { makeTempDir } from '../control/harness.js';
import { sweepRepositories, tableDigests, v010Readability } from './v010-readers.js';

/*
 * WG-V data-copy check (docs/workflow-graph/RESUME.md at tag v0.3.0, Step 4b item 4; the owner
 * consented in chat on 2026-10-20 to checking the new build on a COPY of their data). The
 * coordinator runs it; it is never run from `pnpm test` against real data (its test uses a
 * synthetic copy). From packages/server:
 *
 *   node --conditions=development --import tsx \
 *     tests/verification/workflow-graph/data-copy-check.ts --data-dir <copy> --port <n>
 *
 * - `--data-dir`: a folder holding a COPY of acp.sqlite (taken with SQLite's online `.backup`). The
 *   live data folder (~/.agent-control-plane, compared by real path, also through a link) and
 *   anything inside it are refused.
 * - `--port`: a free port; 7420 and 5173 (the owner's app) are refused; 0 picks one.
 * - `ACP_CLAUDE_DIR`: must be an existing EMPTY folder (and not ~/.claude); unset, a temp one is
 *   made. The home folder the server sees is a temp one too, so nothing under the owner's ~/.claude
 *   is read, listed or resolved.
 *
 * It starts the current server in-process in live mode on the copy, with a managed adapter that
 * refuses every agent start (counted: it must stay 0), calls only read-only GET routes (every
 * project's workflow graph, version 1 workflow, setup, board, tickets, skills and agents; every
 * ticket; every run's page, version 1 workflow and run graph), stops the server, and then reads the
 * copy directly: which tables the start changed (restart recovery, a default setup), whether every
 * row still reads with today's repositories, and whether v0.1.0's readers still read every row
 * (the rollback check). It prints ONE aggregate JSON object to stdout: counts, pass or fail per
 * check, HTTP status counts and graph issue codes. No names, ticket text, plans, paths or ids. Exit
 * 0 when every check passed, 1 when one failed, 2 when refused.
 */

class Refused extends Error {}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const inside = (path: string, root: string) => path === root || path.startsWith(`${root}${sep}`);

function checkedDataDir(): string {
  const given = arg('--data-dir');
  if (given === undefined) throw new Refused('--data-dir <copy> is required');
  const dir = realOrResolved(given);
  const live = realOrResolved(join(homedir(), '.agent-control-plane'));
  if (inside(dir, live) || inside(live, dir)) {
    throw new Refused('--data-dir is the live data folder (or holds it): use a copy');
  }
  if (!existsSync(join(dir, 'acp.sqlite'))) throw new Refused('--data-dir has no acp.sqlite');
  return dir;
}

function checkedPort(): number {
  const given = arg('--port');
  const port = Number(given);
  if (given === undefined || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Refused('--port <n> is required (0 picks a free one)');
  }
  if (port === 7420 || port === 5173) throw new Refused('ports 7420 and 5173 are the owner’s app');
  return port;
}

/** The Claude dir the server observes: an empty folder, never the owner's ~/.claude. */
function checkedClaudeDir(made: string[]): string {
  const given = process.env['ACP_CLAUDE_DIR'];
  if (given === undefined || given === '') {
    const dir = makeTempDir('acp-wgv-copy-claude-');
    made.push(dir);
    return dir;
  }
  const dir = realOrResolved(given);
  if (inside(dir, realOrResolved(join(homedir(), '.claude')))) {
    throw new Refused('ACP_CLAUDE_DIR must not be ~/.claude');
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Refused('ACP_CLAUDE_DIR must be an existing empty folder');
  }
  if (readdirSync(dir).length > 0) throw new Refused('ACP_CLAUDE_DIR must be empty');
  return dir;
}

/** Refuses every agent start: no run may ever start here. */
function refusingAdapter(): { adapter: ManagedExecutionAdapter; starts: () => number } {
  let starts = 0;
  return {
    starts: () => starts,
    adapter: {
      provider: 'claude-code',
      start() {
        starts++;
        const events: AsyncIterable<ManagedAgentEvent> = {
          async *[Symbol.asyncIterator]() {
            await Promise.resolve();
            yield { type: 'finished', outcome: 'error', reportedCostUsd: null };
          },
        };
        return {
          events,
          send: () => Promise.reject(new Error('refused')),
          interrupt: () => Promise.resolve(),
          abort: () => undefined,
        };
      },
    },
  };
}

interface Check {
  total: number;
  passed: number;
  failed: number;
  /** HTTP status (and error code when not 2xx) → count. */
  statuses: Record<string, number>;
}

async function main(): Promise<{ ok: boolean; report: Record<string, unknown> }> {
  const dataDir = checkedDataDir();
  const port = checkedPort();
  const made: string[] = [];
  try {
    const claudeDir = checkedClaudeDir(made);
    const homeDir = makeTempDir('acp-wgv-copy-home-');
    made.push(homeDir);
    const logDir = makeTempDir('acp-wgv-copy-log-');
    made.push(logDir);
    const databasePath = join(dataDir, 'acp.sqlite');

    const readableBefore = v010Readability(databasePath);
    const digestsBefore = tableDigests(databasePath);

    const config = loadConfig(
      {
        ACP_MODE: 'live',
        ACP_DATA_DIR: dataDir,
        ACP_PORT: String(port === 0 ? 7769 : port),
        ACP_CLAUDE_DIR: claudeDir,
        ACP_MANAGED: 'on',
        // The empty Claude dir needs no polling.
        ACP_POLL_INTERVAL_MS: '3600000',
      },
      { homeDir },
    );
    const refusing = refusingAdapter();
    // The server's own log stays in a temp file that is deleted: it is never printed.
    const logFile = join(logDir, 'server.log');
    const server = await startServer({
      config,
      port,
      logger: createLogger((line) => appendFileSync(logFile, `${line}\n`)),
      managedAdapter: refusing.adapter,
    });
    const base = `http://127.0.0.1:${server.port}`;
    const checks: Record<string, Check> = {};
    const stored: Record<string, number> = {};
    const issueCodes: Record<'error' | 'warning', Record<string, number>> = {
      error: {},
      warning: {},
    };
    const count = (into: Record<string, number>, key: string) => {
      into[key] = (into[key] ?? 0) + 1;
    };

    /** A GET only; `expect` says which answers pass. */
    async function get(
      check: string,
      path: string,
      expect: (status: number, code: string | undefined) => boolean = (s) => s === 200,
    ): Promise<unknown> {
      const c = (checks[check] ??= { total: 0, passed: 0, failed: 0, statuses: {} });
      c.total++;
      let status: number;
      let body: unknown = null;
      try {
        const res = await fetch(`${base}${path}`);
        status = res.status;
        const text = await res.text();
        body = text === '' ? null : (JSON.parse(text) as unknown);
      } catch {
        status = 0;
      }
      const code =
        status >= 400
          ? (body as { error?: { code?: unknown } } | null)?.error?.code?.toString()
          : undefined;
      count(c.statuses, code === undefined ? String(status) : `${status} ${code}`);
      if (expect(status, code)) c.passed++;
      else c.failed++;
      return status === 200 ? body : undefined;
    }

    const shapeFailures: Record<string, number> = {};
    const parse = <T>(
      check: string,
      schema: { safeParse(v: unknown): { success: boolean; data?: T } },
      body: unknown,
    ): T | undefined => {
      if (body === undefined) return undefined;
      const r = schema.safeParse(body);
      if (!r.success) count(shapeFailures, check);
      return r.success ? r.data : undefined;
    };

    let projects = 0;
    let tickets = 0;
    const runIds = new Set<string>();
    try {
      await get('health', '/api/health');
      const list =
        parse('projects', ProjectDtoSchema.array(), await get('projects', '/api/projects')) ?? [];
      projects = list.length;
      for (const p of list) {
        const at = `/api/projects/${encodeURIComponent(p.id)}`;
        const graph = parse(
          'workflow-graph',
          WorkflowGraphDtoSchema,
          await get('workflow-graph', `${at}/workflow-graph`),
        );
        if (graph !== undefined) {
          count(stored, graph.stored);
          for (const issue of graph.issues) count(issueCodes[issue.severity], issue.code);
        }
        // Version 1: answers for v1 and default; a stored graph answers 409 `workflow_is_graph`.
        await get('workflow-v1', `${at}/workflow`, (s, code) =>
          graph?.stored === 'v2' ? s === 409 && code === 'workflow_is_graph' : s === 200,
        );
        await get('setup', `${at}/setup`);
        await get('board', `/api/board?projectId=${encodeURIComponent(p.id)}`);
        await get('skills', `${at}/skills`);
        await get('agents', `${at}/agents`);
        const ts =
          parse('tickets', TicketDtoSchema.array(), await get('tickets', `${at}/tickets`)) ?? [];
        for (const t of ts) {
          tickets++;
          const d = parse(
            'ticket',
            TicketDetailDtoSchema,
            await get('ticket', `/api/tickets/${encodeURIComponent(t.id)}`),
          );
          for (const r of d?.runs ?? []) runIds.add(r.id);
        }
      }
      const all = parse('runs', RunSummaryDtoSchema.array(), await get('runs', '/api/runs')) ?? [];
      for (const r of all) runIds.add(r.id);
      for (const id of runIds) {
        const at = `/api/runs/${encodeURIComponent(id)}`;
        parse('run', RunDetailDtoSchema, await get('run', at));
        parse(
          'run-workflow-graph',
          RunWorkflowGraphDtoSchema,
          await get('run-workflow-graph', `${at}/workflow-graph`),
        );
        await get('run-workflow-v1', `${at}/workflow`);
      }
    } finally {
      await server.close();
    }

    const digestsAfter = tableDigests(databasePath);
    const tablesChanged: Record<string, { rowsBefore: number; rowsAfter: number }> = {};
    for (const [table, after] of Object.entries(digestsAfter)) {
      const before = digestsBefore[table];
      if (before?.digest !== after.digest) {
        tablesChanged[table] = { rowsBefore: before?.rows ?? 0, rowsAfter: after.rows };
      }
    }
    const sweep = sweepRepositories(databasePath);
    const readableAfter = v010Readability(databasePath);
    const sum = (r: Record<string, number>) => Object.values(r).reduce((n, x) => n + x, 0);
    const checksPassed = Object.values(checks).every((c) => c.failed === 0);
    const assertions = {
      everyGetAnswered: checksPassed,
      everyBodyParsed: sum(shapeFailures) === 0,
      noErrorIssue: sum(issueCodes.error) === 0,
      noAgentStarted: refusing.starts() === 0,
      repositoriesReadEveryRow: Object.keys(sweep.failed).length === 0,
      v010ReadsEveryRowAfter: sum(readableAfter.unreadable) === 0,
    };
    return {
      ok: Object.values(assertions).every(Boolean),
      report: {
        assertions,
        counts: { projects, tickets, runs: runIds.size },
        workflowGraphs: {
          stored,
          errorIssues: sum(issueCodes.error),
          warningIssues: sum(issueCodes.warning),
          issueCodes,
        },
        checks,
        shapeFailures,
        agentStartsAttempted: refusing.starts(),
        tablesChanged,
        repositories: { rowsRead: sweep.read, readFailures: sweep.failed },
        v010Readers: {
          before: { rows: readableBefore.rows, unreadable: readableBefore.unreadable },
          after: { rows: readableAfter.rows, unreadable: readableAfter.unreadable },
          // Fixed parser messages and schema paths only, never a value.
          reasonsAfter: readableAfter.reasons,
        },
      },
    };
  } finally {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  }
}

try {
  const { ok, report } = await main();
  process.stdout.write(`${JSON.stringify({ ok, ...report }, null, 2)}\n`);
  process.exit(ok ? 0 : 1);
} catch (error) {
  if (error instanceof Refused) {
    process.stderr.write(`Refusing: ${error.message}\n`);
    process.exit(2);
  }
  // Only the error's name: a message could quote a path or a stored value.
  process.stderr.write(
    `data-copy check failed: ${error instanceof Error ? error.name : 'error'}\n`,
  );
  process.exit(1);
}
