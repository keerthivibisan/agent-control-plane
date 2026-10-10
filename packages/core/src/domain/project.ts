import { z } from 'zod';
import { IsoTimestampSchema } from './time.js';

/** POSIX absolute path or Windows drive-absolute path. Normalisation and allowlisting happen in the server. */
export const AbsolutePathSchema = z
  .string()
  .min(1)
  .refine((p) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p), 'must be an absolute path');

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  /** Registered repository root. Sessions match a project only when their cwd is inside this root. */
  rootPath: AbsolutePathSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

export const RegisterProjectInputSchema = z.object({
  name: z.string().min(1).max(200),
  rootPath: AbsolutePathSchema,
});
export type RegisterProjectInput = z.infer<typeof RegisterProjectInputSchema>;
