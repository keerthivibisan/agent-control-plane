import type { CodeMapLanguage } from '@acp/core';
import type { CodeMapGraphEdge, CodeMapGraphNode } from '@acp/core/api';

/**
 * The code map's drawing (ADR-0034 §5, CM-4): a deterministic grid by folder, no layout library.
 * Every group (the node's `folder`) is a box; its nodes are stacked in columns of at most
 * `MAX_ROWS`, sorted by path. Boxes are sorted by path and packed left to right into shelves
 * about as wide as the drawing is tall, so the same view always gives the same positions.
 */

export interface CodeMapFilters {
  /** One language, or null for all. */
  language: CodeMapLanguage | null;
  hideTests: boolean;
  /** Only nodes with at least one import link in or out. */
  linkedOnly: boolean;
}

export const NO_FILTERS: CodeMapFilters = { language: null, hideTests: false, linkedOnly: false };

export const NODE_WIDTH = 216;
export const FILE_HEIGHT = 30;
export const FOLDER_HEIGHT = 44;
const ROW_GAP = 8;
const COL_GAP = 12;
const PAD = 12;
const HEADER = 34;
const GROUP_GAP = 28;
const MAX_ROWS = 16;

export interface PlacedGroup {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

export interface PlacedNode {
  node: CodeMapGraphNode;
  /** The box it sits in. */
  group: string;
  /** Relative to its group's box. */
  x: number;
  y: number;
}

export interface CodeMapLayout {
  groups: PlacedGroup[];
  nodes: PlacedNode[];
  edges: CodeMapGraphEdge[];
  width: number;
  height: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The nodes the filters keep, and the edges between kept nodes. */
export function filterGraph(
  nodes: readonly CodeMapGraphNode[],
  edges: readonly CodeMapGraphEdge[],
  filters: CodeMapFilters,
): { nodes: CodeMapGraphNode[]; edges: CodeMapGraphEdge[] } {
  const kept = nodes.filter(
    (n) =>
      (filters.language === null || n.language === filters.language) &&
      (!filters.hideTests || !n.isTest) &&
      (!filters.linkedOnly || n.importCount + n.importedByCount > 0),
  );
  const ids = new Set(kept.map((n) => n.id));
  return { nodes: kept, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

/** Lays out one view. Pure: equal input gives equal output, whatever order the nodes came in. */
export function layoutCodeMap(
  nodes: readonly CodeMapGraphNode[],
  edges: readonly CodeMapGraphEdge[],
): CodeMapLayout {
  const byGroup = new Map<string, CodeMapGraphNode[]>();
  for (const n of nodes) {
    const list = byGroup.get(n.folder);
    if (list === undefined) byGroup.set(n.folder, [n]);
    else list.push(n);
  }
  const boxes = [...byGroup.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([path, members]) => {
      const sorted = [...members].sort((a, b) => cmp(a.id, b.id));
      const height = sorted.some((n) => n.kind === 'folder') ? FOLDER_HEIGHT : FILE_HEIGHT;
      const cols = Math.ceil(sorted.length / MAX_ROWS);
      const rows = Math.min(sorted.length, MAX_ROWS);
      return {
        path,
        members: sorted,
        nodeHeight: height,
        width: PAD * 2 + cols * NODE_WIDTH + (cols - 1) * COL_GAP,
        height: HEADER + rows * height + (rows - 1) * ROW_GAP + PAD,
      };
    });

  // Shelves about as wide as the whole drawing is tall (a roughly square map), never narrower
  // than the widest box.
  const area = boxes.reduce((s, b) => s + (b.width + GROUP_GAP) * (b.height + GROUP_GAP), 0);
  const widest = boxes.reduce((m, b) => Math.max(m, b.width), 0);
  const shelfWidth = Math.max(widest, Math.round(Math.sqrt(area) * 1.4));

  const groups: PlacedGroup[] = [];
  const placed: PlacedNode[] = [];
  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  let width = 0;
  for (const box of boxes) {
    if (x > 0 && x + box.width > shelfWidth) {
      x = 0;
      y += shelfHeight + GROUP_GAP;
      shelfHeight = 0;
    }
    groups.push({
      path: box.path,
      x,
      y,
      width: box.width,
      height: box.height,
      count: box.members.length,
    });
    box.members.forEach((node, i) => {
      const col = Math.floor(i / MAX_ROWS);
      const row = i % MAX_ROWS;
      placed.push({
        node,
        group: box.path,
        x: PAD + col * (NODE_WIDTH + COL_GAP),
        y: HEADER + row * (box.nodeHeight + ROW_GAP),
      });
    });
    width = Math.max(width, x + box.width);
    shelfHeight = Math.max(shelfHeight, box.height);
    x += box.width + GROUP_GAP;
  }
  const sortedEdges = [...edges].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
  return { groups, nodes: placed, edges: sortedEdges, width, height: y + shelfHeight };
}

/** An import link's stroke: 1px for one import, thicker (log scale, at most 6px) for more. */
export function edgeWidth(weight: number): number {
  return Math.min(6, 1 + Math.log2(Math.max(weight, 1)));
}

/** The last segment of a path, for a node's label. */
export function lastSegment(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/** `a/b/c` → `[a, a/b, a/b/c]`: the breadcrumbs of a folder. */
export function folderTrail(folder: string | null): string[] {
  if (folder === null) return [];
  const segments = folder.split('/');
  return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
}

/**
 * Whether a folder node can be opened: not the root (`.` is not a folder query) and not the
 * folder already open (its own files at the collapse depth).
 */
export function canOpenFolder(id: string, current: string | null): boolean {
  return id !== '.' && id !== current;
}
