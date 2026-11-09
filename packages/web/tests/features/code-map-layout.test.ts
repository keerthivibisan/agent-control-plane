import type { CodeMapGraphNode } from '@acp/core/api';
import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  NODE_WIDTH,
  canOpenFolder,
  edgeWidth,
  filterGraph,
  folderTrail,
  layoutCodeMap,
} from '../../src/features/code-map/layout';
import { fileGraph, folderGraph } from '../fixtures/code-map';

/* CM-4: the code map's deterministic grid layout and its filters (pure). */

function many(n: number, folder: string): CodeMapGraphNode[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${folder}/f${String(i).padStart(3, '0')}.ts`,
    kind: 'file' as const,
    folder,
    language: 'typescript' as const,
    isTest: false,
    fileCount: 1,
    symbolCount: 0,
    importCount: 0,
    importedByCount: 0,
  }));
}

describe('layoutCodeMap', () => {
  it('gives the same positions for the same input, whatever the order', () => {
    const g = fileGraph();
    const a = layoutCodeMap(g.nodes, g.edges);
    const b = layoutCodeMap([...g.nodes].reverse(), [...g.edges].reverse());
    expect(b).toEqual(a);
    expect(layoutCodeMap(g.nodes, g.edges)).toEqual(a);
  });

  it('puts one box per folder, sorted, with files sorted inside and no overlap', () => {
    const g = fileGraph();
    const layout = layoutCodeMap(g.nodes, g.edges);
    expect(layout.groups.map((x) => x.path)).toEqual(['src', 'src/lib', 'tests']);
    const lib = layout.nodes.filter((p) => p.group === 'src/lib');
    expect(lib.map((p) => p.node.id)).toEqual(['src/lib/data.json', 'src/lib/util.ts']);
    expect((lib[1]?.y ?? 0) > (lib[0]?.y ?? 0)).toBe(true);
    // Boxes on one shelf don't overlap.
    const boxes = layout.groups;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i];
        const q = boxes[j];
        if (p === undefined || q === undefined) continue;
        const apart =
          p.x + p.width <= q.x ||
          q.x + q.width <= p.x ||
          p.y + p.height <= q.y ||
          q.y + q.height <= p.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('wraps a big folder into columns and the boxes into shelves', () => {
    const nodes = [...many(40, 'a'), ...many(3, 'b'), ...many(3, 'c'), ...many(3, 'd')];
    const layout = layoutCodeMap(nodes, []);
    const a = layout.groups.find((g) => g.path === 'a');
    // 40 files in columns of 16: 3 columns.
    const columns = new Set(layout.nodes.filter((p) => p.group === 'a').map((p) => p.x));
    expect(columns.size).toBe(3);
    expect(a?.width).toBeGreaterThan(NODE_WIDTH * 3);
    // More than one shelf.
    expect(new Set(layout.groups.map((g) => g.y)).size).toBeGreaterThan(1);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('lays out folder nodes too', () => {
    const g = folderGraph();
    const layout = layoutCodeMap(g.nodes, g.edges);
    expect(layout.groups.map((x) => x.path)).toEqual(['.']);
    expect(layout.nodes.map((p) => p.node.id)).toEqual(['.', 'packages', 'tests']);
  });
});

describe('filters and helpers', () => {
  it('filters by language, tests and links; drops edges to hidden nodes', () => {
    const g = fileGraph();
    expect(filterGraph(g.nodes, g.edges, NO_FILTERS).nodes).toHaveLength(4);
    const noTests = filterGraph(g.nodes, g.edges, { ...NO_FILTERS, hideTests: true });
    expect(noTests.nodes.map((n) => n.id)).not.toContain('tests/util.test.ts');
    expect(noTests.edges).toEqual([{ from: 'src/index.ts', to: 'src/lib/util.ts', weight: 1 }]);
    const json = filterGraph(g.nodes, g.edges, { ...NO_FILTERS, language: 'json' });
    expect(json.nodes.map((n) => n.id)).toEqual(['src/lib/data.json']);
    expect(json.edges).toEqual([]);
    const linked = filterGraph(g.nodes, g.edges, { ...NO_FILTERS, linkedOnly: true });
    expect(linked.nodes.map((n) => n.id)).not.toContain('src/lib/data.json');
  });

  it('edge widths grow with weight and stop at 6', () => {
    expect(edgeWidth(1)).toBe(1);
    expect(edgeWidth(2)).toBe(2);
    expect(edgeWidth(4)).toBe(3);
    expect(edgeWidth(10_000)).toBe(6);
  });

  it('breadcrumbs and which folders open', () => {
    expect(folderTrail(null)).toEqual([]);
    expect(folderTrail('a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
    expect(canOpenFolder('.', null)).toBe(false);
    expect(canOpenFolder('a/b', 'a/b')).toBe(false);
    expect(canOpenFolder('a/b', 'a')).toBe(true);
  });
});
