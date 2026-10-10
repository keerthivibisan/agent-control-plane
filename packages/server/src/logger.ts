import { redact } from '@acp/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void;
}

/**
 * Structured JSON lines. Free text is redacted, and callers pass identifiers and counts only:
 * never payloads, file contents or conversation text (AGENTS.md §6, docs/security.md §2.5).
 */
export function createLogger(
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  now: () => Date = () => new Date(),
): Logger {
  return {
    log(level, message, fields = {}) {
      const safe: Record<string, string | number | boolean | null> = {};
      for (const [k, v] of Object.entries(fields)) safe[k] = typeof v === 'string' ? redact(v) : v;
      write(
        JSON.stringify({ time: now().toISOString(), level, message: redact(message), ...safe }),
      );
    },
  };
}

export const silentLogger: Logger = { log() {} };

/**
 * What may be logged about a caught error: its class name and, for Node system errors, the code
 * (`EACCES`, `EADDRINUSE`). Never the message, which can quote file paths, payloads or SQL values.
 */
export function errorFields(error: unknown): { errorName: string; errorCode: string | null } {
  const errorName = error instanceof Error ? error.name : 'unknown';
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return {
    errorName,
    // Only short machine codes; anything else could be free text.
    errorCode: typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,40}$/.test(code) ? code : null,
  };
}
