import type { HarnessCheck, HarnessManifest } from './workspace.js';
import type {
  CheckSelection,
  GraphIssue,
  WorkflowGraph,
  WorkflowNodeOf,
} from './workflow-graph.js';
import { CHECK_PLACE_NAMES, checkBlockOf } from './graph/check-blocks.js';
import { clip, indexNodes, q } from './graph/graph-index.js';

/**
 * Which of the harness file's checks a Checks block runs (ADR-0027 §4, §5). Pure: the server
 * reads the harness file of the checkout a block runs in and passes it here.
 */

/**
 * The checks a block with `selection` runs, in the harness file's order, each at most once:
 * - `required`: every required check (what the one fixed block ran before ADR-0027);
 * - `ids`: the checks with those ids; an id the file does not have is skipped;
 * - `labels`: every check carrying at least one of the labels, required or not.
 *
 * An empty list means the block runs nothing (and passes); `checkSelectionIssues` warns about it.
 */
export function checksForBlock(
  manifest: Pick<HarnessManifest, 'checks'>,
  selection: CheckSelection,
): HarnessCheck[] {
  switch (selection.kind) {
    case 'required':
      return manifest.checks.filter((c) => c.required);
    case 'ids':
      return manifest.checks.filter((c) => selection.ids.includes(c.id));
    case 'labels':
      return manifest.checks.filter((c) =>
        (c.labels ?? []).some((label) => selection.labels.includes(label)),
      );
  }
}

function names(checks: readonly Pick<HarnessCheck, 'name'>[]): string {
  return checks.map((c) => `"${c.name}"`).join(', ');
}

function warning(
  code: GraphIssue['code'],
  node: WorkflowNodeOf<'checks'>,
  message: string,
): GraphIssue {
  return { code, severity: 'warning', message: clip(message), nodeId: node.id };
}

/**
 * Warnings about each Checks block's selection against the project's harness file, in graph
 * order (ADR-0027 §5: "warns when a name no longer exists in the harness file"). Warnings never
 * block a graph: the file is changed through tickets and can be out of step with the graph for a
 * while, and the owner's merge still needs the required checks on the tip.
 *
 * - `unknown-check`: a selected id the file does not have;
 * - `unknown-check-label`: a selected label no check carries;
 * - `no-checks-selected`: the block would run no check at all (also every block that is not
 *   today's default block when the project has no harness file, `manifest` null);
 * - `merge-skips-required`: the block before the lead's merge leaves out required checks, so a
 *   change can be merged into the ticket branch without them (they still gate your merge).
 */
export function checkSelectionIssues(
  graph: Pick<WorkflowGraph, 'nodes'>,
  manifest: Pick<HarnessManifest, 'checks'> | null,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const node of indexNodes(graph.nodes).unique) {
    if (node.type !== 'checks') continue;
    const block = checkBlockOf(node);
    const where = CHECK_PLACE_NAMES[block.place];
    if (manifest === null) {
      if (block.place !== 'merge' || block.select.kind !== 'required') {
        issues.push(
          warning(
            'no-checks-selected',
            node,
            `The project has no harness file (.acp/harness.json), so ${q(node)} ${where} runs no checks.`,
          ),
        );
      }
      continue;
    }
    const select = block.select;
    if (select.kind === 'ids') {
      for (const id of select.ids) {
        if (!manifest.checks.some((c) => c.id === id)) {
          issues.push(
            warning(
              'unknown-check',
              node,
              `${q(node)} runs the check "${id}", which the harness file does not have. It is skipped.`,
            ),
          );
        }
      }
    } else if (select.kind === 'labels') {
      for (const label of select.labels) {
        if (!manifest.checks.some((c) => (c.labels ?? []).includes(label))) {
          issues.push(
            warning(
              'unknown-check-label',
              node,
              `${q(node)} runs the checks labelled "${label}", but no check in the harness file has that label.`,
            ),
          );
        }
      }
    }
    const selected = checksForBlock(manifest, select);
    if (selected.length === 0) {
      issues.push(
        warning(
          'no-checks-selected',
          node,
          select.kind === 'required'
            ? `${q(node)} ${where} runs every required check, but the harness file marks none as required, so it runs nothing.`
            : `${q(node)} ${where} selects no check from the harness file, so it runs nothing.`,
        ),
      );
    }
    if (block.place === 'merge') {
      const missing = manifest.checks.filter((c) => c.required && !selected.includes(c));
      if (missing.length > 0) {
        issues.push(
          warning(
            'merge-skips-required',
            node,
            `${q(node)} does not run the required check${missing.length === 1 ? '' : 's'} ${names(missing)}, so a change can reach the ticket branch without ${missing.length === 1 ? 'it' : 'them'}. Your merge still needs every required check on the ticket branch.`,
          ),
        );
      }
    }
  }
  return issues;
}
