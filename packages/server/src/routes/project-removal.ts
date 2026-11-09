import { Router } from 'express';
import { ProjectRemovalPreviewDtoSchema } from '@acp/core/api';
import { requireCsrf } from '../control/csrf.js';
import type { ProjectRemovalService } from '../projects/removal.js';
import { out, param } from './respond.js';

/** ADR-0036: the removal preview, and removing a project from ACP (CSRF, as every mutation). */
export function createProjectRemovalRouter(
  removal: ProjectRemovalService,
  csrfToken: string,
): Router {
  const router = Router();
  const csrf = requireCsrf(csrfToken);
  router.get('/projects/:id/removal', (req, res) => {
    res.json(out(ProjectRemovalPreviewDtoSchema, removal.preview(param(req.params['id']))));
  });
  router.delete('/projects/:id', csrf, async (req, res) => {
    await removal.remove(param(req.params['id']));
    res.status(204).end();
  });
  return router;
}
