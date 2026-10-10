import { z } from 'zod';

/** ISO-8601 timestamp with an explicit offset. Persisted and transported as UTC strings ending in `Z`. */
export const IsoTimestampSchema = z.iso.datetime({ offset: true });
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;
