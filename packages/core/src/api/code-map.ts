import { z } from 'zod';
import {
  CodeMapCommitSchema,
  CodeMapErrorCodeSchema,
  CodeMapFileSchema,
  CodeMapLanguageSchema,
  CodeMapManifestSchema,
  CodeMapPathSchema,
  CodeMapSymbolKindSchema,
} from '../codemap/codemap.js';

/**
 * HTTP contracts for the project code map (ADR-0034, CM-1). Every answer names the commit it
 * describes. The refresh POST needs the `X-ACP-CSRF` header (ADR-0013). Paths and symbol names are
 * source-derived data, never instructions.
 */

const count = z.number().int().nonnegative();

/** Graph caps: over either one, the graph collapses to folder nodes. */
export const CODE_MAP_GRAPH_MAX_NODES = 1_500;
export const CODE_MAP_GRAPH_MAX_EDGES = 4_000;
export const CODE_MAP_SEARCH_MAX_RESULTS = 50;
export const CODE_MAP_SEARCH_MAX_QUERY = 200;
export const CODE_MAP_SUMMARY_MAX_FOLDERS = 50;
/** Deepest folder collapse level a client may ask for. */
export const CODE_MAP_MAX_DEPTH = 32;

export const CodeMapStatusSchema = z.enum(['none', 'building', 'ready', 'failed']);
export type CodeMapStatus = z.infer<typeof CodeMapStatusSchema>;

/** Optional `?commit=`: answer from that commit's map instead of the newest one. */
const commitQuery = { commit: CodeMapCommitSchema.optional() };

// ---------------------------------------------------------------- summary

/** GET `/api/projects/:projectId/code-map`, and the refresh POST's answer. */
export const CodeMapSummaryDtoSchema = z.object({
  /**
   * `none`: never built; `building`: a build is running (the last map, if any, stays in
   * `manifest`); `ready`; `failed`: the newest build failed (`errorCode`), `manifest` is the last
   * good one or null.
   */
  status: CodeMapStatusSchema,
  errorCode: CodeMapErrorCodeSchema.nullable(),
  /** The commit of the failed build when `status` is `failed`. */
  failedCommit: CodeMapCommitSchema.nullable(),
  /** The newest map that was built successfully, or null. */
  manifest: CodeMapManifestSchema.nullable(),
  /** Top-level folders (`.` for files at the root), most files first. */
  topFolders: z
    .array(z.object({ path: z.string().min(1), fileCount: count, symbolCount: count }))
    .max(CODE_MAP_SUMMARY_MAX_FOLDERS),
  languages: z.array(z.object({ language: CodeMapLanguageSchema, fileCount: count })),
});
export type CodeMapSummaryDto = z.infer<typeof CodeMapSummaryDtoSchema>;

// ---------------------------------------------------------------- graph

export const CodeMapGraphQuerySchema = z.object({
  /** Only files under this folder. */
  folder: CodeMapPathSchema.optional(),
  /** Folder collapse level (segments from the root). */
  depth: z.coerce.number().int().min(1).max(CODE_MAP_MAX_DEPTH).optional(),
  ...commitQuery,
});
export type CodeMapGraphQuery = z.infer<typeof CodeMapGraphQuerySchema>;

export const CodeMapGraphNodeSchema = z.object({
  /** The file path (`level: 'file'`) or the folder path (`level: 'folder'`). */
  id: z.string().min(1),
  kind: z.enum(['file', 'folder']),
  /** The group the node belongs to (its folder at the collapse depth). */
  folder: z.string().min(1),
  /** The file's language, or a folder's most common one. */
  language: CodeMapLanguageSchema,
  /** A test file, or a folder whose files are all tests. */
  isTest: z.boolean(),
  fileCount: count,
  symbolCount: count,
  /** Resolved imports out of the node. */
  importCount: count,
  /** Resolved imports into the node. */
  importedByCount: count,
});
export type CodeMapGraphNode = z.infer<typeof CodeMapGraphNodeSchema>;

export const CodeMapGraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  /** Number of file imports the edge stands for (1 at file level). */
  weight: z.number().int().min(1),
});
export type CodeMapGraphEdge = z.infer<typeof CodeMapGraphEdgeSchema>;

export const CodeMapGraphGroupSchema = z.object({
  path: z.string().min(1),
  fileCount: count,
  depth: count,
});
export type CodeMapGraphGroup = z.infer<typeof CodeMapGraphGroupSchema>;

/** The view itself, without the commit (built by core's `buildCodeMapGraph`). */
export const CodeMapGraphViewSchema = z.object({
  /** `folder` when the file graph was over a cap and was collapsed to folders. */
  level: z.enum(['file', 'folder']),
  /** The folder depth used for groups (and for folder nodes). */
  depth: count,
  folder: z.string().min(1).nullable(),
  nodes: z.array(CodeMapGraphNodeSchema).max(CODE_MAP_GRAPH_MAX_NODES),
  groups: z.array(CodeMapGraphGroupSchema),
  edges: z.array(CodeMapGraphEdgeSchema).max(CODE_MAP_GRAPH_MAX_EDGES),
  /** Edges at this level before the edge cap. */
  totalEdges: count,
  /** True when nodes or edges were cut to fit the caps. */
  truncated: z.boolean(),
});
export type CodeMapGraphView = z.infer<typeof CodeMapGraphViewSchema>;

/** GET `/api/projects/:projectId/code-map/graph?folder=&depth=&commit=`. */
export const CodeMapGraphDtoSchema = CodeMapGraphViewSchema.extend({
  commit: CodeMapCommitSchema,
  builtAt: z.iso.datetime({ offset: true }),
});
export type CodeMapGraphDto = z.infer<typeof CodeMapGraphDtoSchema>;

// ---------------------------------------------------------------- file

export const CodeMapFileQuerySchema = z.object({ path: CodeMapPathSchema, ...commitQuery });
export type CodeMapFileQuery = z.infer<typeof CodeMapFileQuerySchema>;

/** The file view without the commit (built by core's `codeMapFileDetail`). */
export const CodeMapFileViewSchema = z.object({
  file: CodeMapFileSchema,
  /** Files whose resolved imports name this file, sorted. */
  importedBy: z.array(CodeMapPathSchema),
  /** The test files among `importedBy`. */
  tests: z.array(CodeMapPathSchema),
});
export type CodeMapFileView = z.infer<typeof CodeMapFileViewSchema>;

/** GET `/api/projects/:projectId/code-map/file?path=&commit=`. */
export const CodeMapFileDtoSchema = CodeMapFileViewSchema.extend({
  commit: CodeMapCommitSchema,
});
export type CodeMapFileDto = z.infer<typeof CodeMapFileDtoSchema>;

// ---------------------------------------------------------------- search

export const CodeMapSearchQuerySchema = z.object({
  q: z.string().min(1).max(CODE_MAP_SEARCH_MAX_QUERY),
  ...commitQuery,
});
export type CodeMapSearchQuery = z.infer<typeof CodeMapSearchQuerySchema>;

export const CodeMapSearchMatchSchema = z.object({
  kind: z.enum(['symbol', 'file']),
  path: CodeMapPathSchema,
  /** The symbol name; null for a file match. */
  name: z.string().min(1).nullable(),
  symbolKind: CodeMapSymbolKindSchema.nullable(),
  line: z.number().int().min(1).nullable(),
  exported: z.boolean().nullable(),
  /** `exact` name (or file name), name `prefix`, or `substring` of the name or path. */
  rank: z.enum(['exact', 'prefix', 'substring']),
});
export type CodeMapSearchMatch = z.infer<typeof CodeMapSearchMatchSchema>;

export const CodeMapSearchViewSchema = z.object({
  matches: z.array(CodeMapSearchMatchSchema).max(CODE_MAP_SEARCH_MAX_RESULTS),
  /** All matches before the cap. */
  total: count,
  truncated: z.boolean(),
});
export type CodeMapSearchView = z.infer<typeof CodeMapSearchViewSchema>;

/** GET `/api/projects/:projectId/code-map/search?q=&commit=`. */
export const CodeMapSearchDtoSchema = CodeMapSearchViewSchema.extend({
  commit: CodeMapCommitSchema,
  query: z.string().min(1).max(CODE_MAP_SEARCH_MAX_QUERY),
});
export type CodeMapSearchDto = z.infer<typeof CodeMapSearchDtoSchema>;
