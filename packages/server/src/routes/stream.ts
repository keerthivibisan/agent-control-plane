import { Router } from 'express';
import type { StreamNoticeDto } from '@acp/core/api';
import type { Repositories } from '@acp/db';
import type { Notifier } from '../notifier.js';

export const HEARTBEAT_MS = 15_000;
const REPLAY_LIMIT = 500;

export interface StreamDeps {
  repos: Repositories;
  notifier: Notifier;
  heartbeatMs?: number;
}

function frame(notice: StreamNoticeDto): string {
  return `id: ${notice.lastEventId}\nevent: notice\ndata: ${JSON.stringify(notice)}\n\n`;
}

/**
 * `GET /api/events/stream`: invalidation notices only; clients refetch over REST. Notices come
 * from the notifier, which the pipeline calls after commit, so nothing is announced before it is
 * durable. A reconnecting client sends `Last-Event-ID` and gets one catch-up notice for what it missed.
 */
export function createStreamRouter(deps: StreamDeps): Router {
  const router = Router();
  router.get('/events/stream', (req, res) => {
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    // Subscribe before replaying so nothing published during the replay is lost.
    const buffered: StreamNoticeDto[] = [];
    let replaying = true;
    const unsubscribe = deps.notifier.subscribe((notice) => {
      if (replaying) buffered.push(notice);
      else res.write(frame(notice));
    });

    const lastEventId = Number(req.headers['last-event-id']);
    let sentUpTo = Number.isInteger(lastEventId) && lastEventId >= 0 ? lastEventId : null;
    if (sentUpTo !== null) {
      const missed = deps.repos.events.listAfter(sentUpTo, REPLAY_LIMIT);
      const last = missed.at(-1);
      if (last !== undefined) {
        sentUpTo = last.id;
        res.write(
          frame({
            kind: 'events-ingested',
            lastEventId: last.id,
            sessionIds: [
              ...new Set(missed.flatMap((m) => (m.sessionId === null ? [] : [m.sessionId]))),
            ],
            projectIds: [
              ...new Set(missed.flatMap((m) => (m.projectId === null ? [] : [m.projectId]))),
            ],
          }),
        );
      }
    }
    replaying = false;
    for (const notice of buffered.splice(0)) {
      if (sentUpTo === null || notice.lastEventId > sentUpTo || notice.kind !== 'events-ingested') {
        res.write(frame(notice));
      }
    }

    const heartbeat = setInterval(
      () => res.write(': heartbeat\n\n'),
      deps.heartbeatMs ?? HEARTBEAT_MS,
    );
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  return router;
}
