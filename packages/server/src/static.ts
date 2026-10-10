import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';

/**
 * Serves the built web UI with a single-page-app fallback. API paths never fall back to the page:
 * `/api/*` unknown routes already answered 404 with an ErrorDto.
 */
export function mountStatic(app: Express, dir: string): boolean {
  const index = join(dir, 'index.html');
  if (!existsSync(index)) return false;
  app.use(express.static(dir, { index: false, fallthrough: true }));
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
    res.sendFile(index);
  });
  return true;
}
