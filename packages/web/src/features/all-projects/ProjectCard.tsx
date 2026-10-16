import type { ProjectDto } from '@acp/core/api';
import { ProjectMark } from '../../app/ProjectSwitcher';
import { InfoTip } from '../../components/InfoTip';
import { Pill, type PillTone } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { boardPaths, boardSchemas } from '../../lib/api';
import {
  ALL_PROJECTS_COPY,
  HARNESS_STATE_COPY,
  NOT_REPORTED,
  STATUS_COPY,
  type HarnessStateCopy,
} from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { FolderPath } from './project-bits';

const C = ALL_PROJECTS_COPY;

const HARNESS_TONE: Record<HarnessStateCopy['tone'], PillTone> = {
  ok: 'success',
  partial: 'warning',
  problem: 'danger',
  none: 'neutral',
};

/**
 * One project on All projects: name and folder, the harness state, what its agent runs are doing
 * (from the project's board) and its Claude Code sessions. The whole card opens the board.
 */
export function ProjectCard({
  project,
  runningSessions,
}: {
  project: ProjectDto;
  /** Running Claude Code sessions in this project; null when the count isn't known. */
  runningSessions: number | null;
}) {
  const board = useApiQuery(boardPaths.board(project.id), boardSchemas.board);
  const b = board.data;
  const harness = b ? HARNESS_STATE_COPY[b.harness.state] : null;
  return (
    <li
      className="group relative flex min-w-0 flex-col rounded-card border border-line bg-panel p-5 shadow-card transition-[border-color,box-shadow] focus-within:border-line-strong hover:border-line-strong hover:shadow-raised"
      data-project-id={project.id}
    >
      <div className="flex items-start gap-3">
        <ProjectMark name={project.name} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-title font-semibold tracking-tight">
            <a
              href={href.project(project.id)}
              className="text-ink no-underline after:absolute after:inset-0 after:rounded-card"
            >
              {project.name}
            </a>
          </h3>
          <FolderPath path={project.rootPath} />
        </div>
        {harness && b ? (
          <span
            className="relative z-10 shrink-0"
            data-testid="card-harness"
            data-state={b.harness.state}
          >
            <Pill tone={HARNESS_TONE[harness.tone]} title={harness.tip}>
              {C.harness}: {harness.word}
            </Pill>
          </span>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="card-runs">
        {b ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${b.stats.runningRuns > 0 ? 'bg-status-active ring-3 ring-status-active/20' : 'bg-status-stale'}`}
              />
              {C.running(b.stats.runningRuns)}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 ${b.stats.needsYou > 0 ? 'font-medium text-warning' : 'text-dim'}`}
            >
              {C.needsYou(b.stats.needsYou)}
            </span>
            <span className="relative z-10">
              <InfoTip tip={C.runsTip} label={C.running(b.stats.runningRuns)} />
            </span>
          </>
        ) : board.error ? (
          <span className="text-unavailable">{C.runsUnavailable}</span>
        ) : (
          <span className="text-dim">…</span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-caption">
        <div className="min-w-0">
          <dt className="text-dim">{C.sessions(project.sessionCount)}</dt>
          <dd className="mt-0.5 font-medium" data-running={runningSessions ?? undefined}>
            {runningSessions === null ? (
              <span className="text-unavailable">{NOT_REPORTED}</span>
            ) : (
              `${formatCount(runningSessions)} ${STATUS_COPY.active.word.toLowerCase()}`
            )}
          </dd>
        </div>
        <div className="relative z-10 min-w-0">
          <dt className="text-dim">{C.lastActivity}</dt>
          <dd className="mt-0.5 font-medium">
            <RelativeTime iso={project.lastEventAt} fallback={C.noActivity} />
          </dd>
        </div>
      </dl>
    </li>
  );
}
