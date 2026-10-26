import { Router } from 'express';
import { ProjectTokensDtoSchema } from '@acp/core/api';
import type { TokensService } from '../tokens/service.js';
import { out, param } from './respond.js';

/**
 * The project Tokens page (docs/history/redesign/README.md §4.5). Read-only, so no CSRF token.
 * Thin: parse, call the tokens service, send the response parsed by its `@acp/core/api` DTO.
 */
export function createTokensRouter(tokens: TokensService): Router {
  const router = Router();
  router.get('/projects/:id/tokens', (req, res) => {
    const dto = tokens.project(param(req.params['id']), req.query);
    res.json(out(ProjectTokensDtoSchema, dto));
  });
  return router;
}
