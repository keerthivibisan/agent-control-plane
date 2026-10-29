import { RunRecoverySchema, type RunRecovery } from '@acp/core';
import type { AcpDatabase } from '../../database.js';
import { createContext, type RepositoryOptions } from '../../internal/context.js';
import { parseInput, parseStoredJson, requireNonEmpty } from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';

export interface RunRecoveryRepository {
  get(runId: string): RunRecovery | undefined;
  set(runId: string, value: RunRecovery): void;
}

export function createRunRecoveryRepository(
  db: AcpDatabase,
  options: RepositoryOptions = {},
): RunRecoveryRepository {
  const ctx = createContext(db, options);
  const get = ctx.connection.prepare('SELECT record FROM run_recovery WHERE run_id = ?');
  const set = ctx.connection.prepare(
    'INSERT INTO run_recovery (run_id, record) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET record = excluded.record',
  );
  return {
    get(runId) {
      const row = get.get(requireNonEmpty(runId, 'runId')) as { record: string } | undefined;
      return row === undefined
        ? undefined
        : parseStoredJson(RunRecoverySchema, row.record, 'run_recovery', 'record');
    },
    set(runId, value) {
      const record = parseInput(RunRecoverySchema, value, 'run recovery');
      guardWrite('run recovery', () =>
        set.run(requireNonEmpty(runId, 'runId'), JSON.stringify(record)),
      );
    },
  };
}
