import {
  MAX_STARTING_POINT_FILES,
  MAX_STARTING_POINT_NOTES,
  type StartingPoints,
  type WorkflowNodeId,
} from '@acp/core';
import { approvedPlan } from './plan-read.js';
import { programOf, resolveHelper } from './program.js';
import type { RunState } from './state.js';

/**
 * ADR-0034 §4 (CM-3): what a helper starts from. The lead names likely files and its findings on
 * a plan step or on `start_agent`; the helper's first prompt then lists them (the server renders
 * them with the run's code map). They are hints, never a scope limit, and never change what the
 * helper may do: the engine only carries them as data.
 */

const norm = (role: string): string => role.trim().replace(/\s+/g, ' ').toLowerCase();

/** The given files (deduplicated, in order, at most 20) and notes, or undefined when empty. */
export function startingPointsOf(
  files: readonly string[] | undefined,
  notes: string | undefined,
): StartingPoints | undefined {
  const list = [...new Set(files ?? [])].slice(0, MAX_STARTING_POINT_FILES);
  const text = (notes ?? '').trim();
  if (list.length === 0 && text === '') return undefined;
  return text === '' ? { files: list } : { files: list, notes: text };
}

/**
 * The starting points of the approved plan's steps that a start of `role` on `node` does: the
 * steps whose helper node (as `submit_plan` resolved it, else by role) and role match, ignoring
 * case and spacing. Several matching steps give their files together and their notes one after
 * the other, each under its title. Undefined without an approved plan or a matching step.
 */
export function planStepStartingPoints(
  state: RunState,
  node: WorkflowNodeId,
  role: string,
): StartingPoints | undefined {
  const plan = approvedPlan(state);
  if (plan === undefined) return undefined;
  const resolved = state.planStepHelpers?.[plan.id];
  const program = programOf(state);
  const key = norm(role);
  const steps = plan.steps.filter((step, i) => {
    if (norm(step.role) !== key) return false;
    const stepNode =
      resolved?.[i] ??
      (() => {
        const r = resolveHelper(program, { role: step.role });
        return r.ok ? r.node.id : null;
      })();
    return stepNode === node;
  });
  if (steps.length === 0) return undefined;
  const files = steps.flatMap((s) => s.files ?? []);
  const withNotes = steps.filter((s) => (s.notes ?? '').trim() !== '');
  const notes =
    withNotes.length === 1 && steps.length === 1
      ? (withNotes[0]?.notes ?? '')
      : withNotes.map((s) => `${s.title}: ${(s.notes ?? '').trim()}`).join('\n\n');
  return startingPointsOf(files, notes.slice(0, MAX_STARTING_POINT_NOTES));
}
