import type { StreamNoticeDto } from '@acp/core/api';

/** In-process fan-out of stream notices to SSE connections. */
export interface Notifier {
  publish(notice: StreamNoticeDto): void;
  subscribe(listener: (notice: StreamNoticeDto) => void): () => void;
  subscriberCount(): number;
}

export function createNotifier(): Notifier {
  const listeners = new Set<(notice: StreamNoticeDto) => void>();
  return {
    publish(notice) {
      for (const listener of [...listeners]) listener(notice);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    subscriberCount: () => listeners.size,
  };
}
