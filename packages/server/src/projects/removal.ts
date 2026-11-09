import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { ProjectRemovalPreviewDto, StreamNoticeDto } from '@acp/core/api';
import {
  createOrchestrationRepositories,
  createWorkspaceRepositories,
  type AcpDatabase,
  type ProjectRemoval,
  type Repositories,
} from '@acp/db';
import type { AttachmentFiles } from '../attachments/files.js';
import type { RunStatus } from '@acp/core';
import { HttpError, notFound } from '../errors.js';
import { errorFields, type Logger } from '../logger.js';
import { removeInsideDataDir, type SafeRemoveOutcome } from './safe-remove.js';

/**
 * Removing a project from ACP (ADR-0036). ACP's own records go (tickets, runs and everything under
 * them, workflow, setup, check history, code map) and so do ACP's own folders for those runs in
 * the data directory. The project folder and its git repository are never touched: no git
 * command runs, no branch is deleted, and only paths that resolve strictly inside the data
 * directory are removed. Observed sessions, events and usage stay, with no project.
 */

export interface ProjectRemovalService {
  /** 404 for an unknown project. */
  preview(projectId: string): ProjectRemovalPreviewDto;
  /**
   * 404 unknown; 409 `project_busy` while a run has not ended or a check or setup step runs.
   * Resolves once the rows are gone and the folders were deleted (failures there are logged and
   * counted, never undone).
   */
  remove(projectId: string): Promise<ProjectRemovalResult>;
}

/** Counts only, for the log and tests: never a path or a name. */
export interface ProjectRemovalResult {
  runs: number;
  tickets: number;
  folders: { removed: number; missing: number; refused: number; failed: number };
  attachmentFiles: { removed: number; kept: number; failed: number };
}

export interface ProjectRemovalDeps {
  db: AcpDatabase;
  repos: Repositories;
  control: {
    activeRuns(projectId: string): { runId: string; status: RunStatus }[];
    forgetRuns(runIds: readonly string[]): void;
    readonly attachmentFiles: AttachmentFiles;
  };
  checks: { projectBusy(projectId: string): boolean };
  /** ADR-0035: the project's open assistant chat, ended first. */
  assistant?: { end(projectId: string): void };
  /** ADR-0034: the project's code map builds, dropped first. */
  codeMap?: { forget(projectId: string): void };
  dataDir: string;
  logger: Logger;
  publish: (notice: StreamNoticeDto) => void;
}

/** ACP's per-run folders under the data dir (ADR-0013, -0019, -0021, ADR-0026 §4 agent copies). */
const RUN_FOLDERS = ['worktrees', 'ticket-checkouts', 'review-checkouts', 'runs'] as const;

export function createProjectRemovalService(deps: ProjectRemovalDeps): ProjectRemovalService {
  const { logger } = deps;
  const ws = createWorkspaceRepositories(deps.db);
  const orch = createOrchestrationRepositories(deps.db);

  function projectOrThrow(projectId: string) {
    const project = deps.repos.projects.getById(projectId);
    if (project === undefined) throw notFound(`Project ${projectId} not found`);
    return project;
  }

  function preview(projectId: string): ProjectRemovalPreviewDto {
    const project = projectOrThrow(projectId);
    const counts = deps.repos.projects.historyCounts(projectId);
    const activeRuns = deps.control.activeRuns(projectId).map(({ runId, status }) => {
      const ticketId = orch.runs.getById(runId)?.ticketId ?? null;
      const ticket = ticketId === null ? undefined : ws.tickets.getById(ticketId);
      return {
        runId,
        ticketId: ticket?.id ?? null,
        ticketKey: ticket?.key ?? null,
        ticketTitle: ticket?.title ?? null,
        status,
      };
    });
    const checksRunning = deps.checks.projectBusy(projectId);
    const busy = activeRuns.length > 0 || checksRunning;
    return {
      projectId,
      name: project.name,
      rootPath: project.rootPath,
      tickets: counts.tickets,
      runs: counts.runs,
      attachments: counts.attachments,
      activeRuns,
      busy,
      ...(busy && { busyReason: activeRuns.length > 0 ? 'active-runs' : 'checks-running' }),
    };
  }

  async function removeFolders(
    removal: ProjectRemoval,
    protect: readonly string[],
  ): Promise<ProjectRemovalResult['folders']> {
    const folders = { removed: 0, missing: 0, refused: 0, failed: 0 };
    const paths = new Set<string>();
    for (const runId of removal.runIds) {
      for (const dir of RUN_FOLDERS) paths.add(join(deps.dataDir, dir, runId));
    }
    // Recorded worktrees normally sit inside worktrees/<runId>; any other recorded path is still
    // only removed when it resolves inside the data dir.
    for (const path of removal.workspacePaths) paths.add(path);
    for (const path of removal.artifactPaths) paths.add(path);
    for (const path of paths) {
      let outcome: SafeRemoveOutcome;
      try {
        outcome = await removeInsideDataDir(deps.dataDir, path, { protect });
      } catch (error) {
        folders.failed++;
        logger.log('warn', 'project removal folder not deleted', errorFields(error));
        continue;
      }
      folders[outcome]++;
    }
    return folders;
  }

  async function removeAttachmentFiles(
    shas: readonly string[],
    protect: readonly string[],
  ): Promise<ProjectRemovalResult['attachmentFiles']> {
    const result = { removed: 0, kept: 0, failed: 0 };
    const files = deps.control.attachmentFiles;
    for (const sha of shas) {
      // Stored by content: another ticket (of any project) may still use the same file.
      if (ws.attachments.countBySha256(sha) > 0) {
        result.kept++;
        continue;
      }
      try {
        const outcome = await removeInsideDataDir(deps.dataDir, files.pathOf(sha), { protect });
        if (outcome === 'refused') result.failed++;
        else result.removed++;
      } catch (error) {
        result.failed++;
        logger.log('warn', 'project removal attachment not deleted', errorFields(error));
      }
    }
    return result;
  }

  return {
    preview,

    async remove(projectId) {
      const project = projectOrThrow(projectId);
      // Resolved before anything changes: the folder (and anything containing it) is never removed.
      const protect = [project.rootPath];
      const realRoot = await realpath(project.rootPath).catch(() => null);
      if (realRoot !== null && realRoot !== project.rootPath) protect.push(realRoot);

      // From the preflight to the commit nothing awaits, so no run or check can start in between.
      const state = preview(projectId);
      if (state.busy) {
        throw new HttpError(
          409,
          'project_busy',
          state.busyReason === 'checks-running'
            ? 'Checks or setup steps are running for this project; wait for them to finish'
            : 'This project has runs that have not ended; stop them first',
        );
      }
      try {
        deps.assistant?.end(projectId);
      } catch (error) {
        // No open chat is the usual case (404); anything else is logged, never blocking.
        if (!(error instanceof HttpError && error.status === 404)) {
          logger.log('warn', 'assistant not ended for removal', errorFields(error));
        }
      }
      deps.codeMap?.forget(projectId);
      const removal = deps.repos.projects.removeWithHistory(projectId);
      if (removal === undefined) throw notFound(`Project ${projectId} not found`);
      deps.control.forgetRuns(removal.runIds);
      deps.publish({
        kind: 'projects-changed',
        lastEventId: deps.repos.events.maxId() ?? 0,
        sessionIds: [],
        projectIds: [projectId],
      });

      const folders = await removeFolders(removal, protect);
      const attachmentFiles = await removeAttachmentFiles(removal.attachmentSha256s, protect);
      const result: ProjectRemovalResult = {
        runs: removal.runIds.length,
        tickets: state.tickets,
        folders,
        attachmentFiles,
      };
      logger.log('info', 'project removed', {
        projectId,
        runs: result.runs,
        tickets: result.tickets,
        foldersRemoved: folders.removed,
        foldersRefused: folders.refused,
        foldersFailed: folders.failed,
        attachmentFilesRemoved: attachmentFiles.removed,
        attachmentFilesKept: attachmentFiles.kept,
        attachmentFilesFailed: attachmentFiles.failed,
      });
      return result;
    },
  };
}
