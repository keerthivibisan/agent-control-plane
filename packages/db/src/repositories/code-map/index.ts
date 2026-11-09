import type { AcpDatabase } from '../../database.js';
import { createContext, type RepositoryOptions } from '../../internal/context.js';
import { createCodeMapRepository, type CodeMapRepository } from './code-map.js';

/** The project code map (migration 0014, ADR-0034): blob cache, manifests and their entries. */
export interface CodeMapRepositories {
  codeMap: CodeMapRepository;
}

export function createCodeMapRepositories(
  db: AcpDatabase,
  options: RepositoryOptions = {},
): CodeMapRepositories {
  const ctx = createContext(db, options);
  return { codeMap: createCodeMapRepository(ctx) };
}

export {
  CODE_MAP_KEPT_MANIFESTS,
  toCodeMapManifest,
  type CodeMapEntryInput,
  type CodeMapFailureInput,
  type CodeMapManifestInput,
  type CodeMapManifestRecord,
  type CodeMapRepository,
} from './code-map.js';
