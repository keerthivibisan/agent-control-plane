import { z } from 'zod';
import { TokenCountsSchema } from '../usage/usage.js';
import { IsoTimestampSchema } from '../domain/time.js';

export const RecoveryAgentIdsSchema = z.array(z.string().min(1));
export const RecoveryOwnerWaitSchema = z
  .object({
    since: IsoTimestampSchema.nullable(),
    totalMs: z.number().int().nonnegative(),
  })
  .strict();
export type RecoveryOwnerWait = z.infer<typeof RecoveryOwnerWaitSchema>;

/** Content-free observations needed to deduplicate a managed run's budget after recovery. */
export const BudgetLedgerSchema = z
  .object({
    entries: z.array(
      z.object({
        messageId: z.string().min(1),
        agentRunIds: z.array(z.string().min(1)).min(1),
        tokens: TokenCountsSchema,
      }),
    ),
  })
  .refine(
    ({ entries }) =>
      new Set(entries.map((entry) => entry.messageId)).size === entries.length &&
      entries.every((entry) =>
        entry.agentRunIds.every((agentId, i, ids) => i === 0 || (ids[i - 1] ?? '') < agentId),
      ),
    'Ledger entries must have unique message ids and sorted unique agent ids',
  );
export type BudgetLedger = z.infer<typeof BudgetLedgerSchema>;

/** Restart metadata is separate from the historical run snapshot for downgrade compatibility. */
export const RunRecoverySchema = z
  .object({
    budgetLedger: BudgetLedgerSchema,
    ownerWait: RecoveryOwnerWaitSchema.optional(),
    restartReworkAgents: RecoveryAgentIdsSchema,
    sealedReviewAgents: RecoveryAgentIdsSchema,
  })
  .strict();
export type RunRecovery = z.infer<typeof RunRecoverySchema>;
