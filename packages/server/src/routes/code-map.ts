import { Router } from 'express';
import {
  CodeMapFileDtoSchema,
  CodeMapGraphDtoSchema,
  CodeMapSearchDtoSchema,
  CodeMapSummaryDtoSchema,
} from '@acp/core/api';
import type { CodeMapService } from '../codemap/service.js';
import { requireCsrf } from '../control/csrf.js';
import { out, param } from './respond.js';

/**
 * The project code map (ADR-0034, CM-1). Thin: parse, call the code map service, send the
 * response parsed by its `@acp/core/api` DTO. The refresh POST needs the `X-ACP-CSRF` token
 * (ADR-0013 §6) and is mounted only when the control panel (which owns the token) is.
 */
export function createCodeMapRouter(codeMap: CodeMapService, csrfToken?: string): Router {
  const router = Router();

  router.get('/projects/:projectId/code-map', (req, res) => {
    res.json(out(CodeMapSummaryDtoSchema, codeMap.summary(param(req.params['projectId']))));
  });
  if (csrfToken !== undefined) {
    router.post(
      '/projects/:projectId/code-map/refresh',
      requireCsrf(csrfToken),
      async (req, res) => {
        const dto = await codeMap.refresh(param(req.params['projectId']));
        res.status(202).json(out(CodeMapSummaryDtoSchema, dto));
      },
    );
  }
  router.get('/projects/:projectId/code-map/graph', (req, res) => {
    const dto = codeMap.graph(param(req.params['projectId']), req.query);
    res.json(out(CodeMapGraphDtoSchema, dto));
  });
  router.get('/projects/:projectId/code-map/file', (req, res) => {
    const dto = codeMap.file(param(req.params['projectId']), req.query);
    res.json(out(CodeMapFileDtoSchema, dto));
  });
  router.get('/projects/:projectId/code-map/search', (req, res) => {
    const dto = codeMap.search(param(req.params['projectId']), req.query);
    res.json(out(CodeMapSearchDtoSchema, dto));
  });

  return router;
}
