import { redact } from '@acp/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(
    level: LogLevel,
    message: string,
    fields?: Readonly<Record<string, string | number | boolean | null>>,
  ): void;
}

/**
 * Structured JSON lines. Free text is redacted, and callers pass identifiers and counts only:
 * never payloads, file contents or conversation text (AGENTS.md §6).
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
