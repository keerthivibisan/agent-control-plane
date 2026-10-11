import type { CandidateRootDto, ProjectDto } from '@acp/core/api';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { QueryView } from '../../components/QueryView';
import { RelativeTime } from '../../components/RelativeTime';
import { paths, schemas } from '../../lib/api';
import { EMPTY, OVERVIEW_COPY, PAGES, SETUP_COPY } from '../../lib/copy';
import { baseName } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { RegisterNotice } from './RegisterProjectForm';
import { useRegisterProject, type RegisterResult } from './register';

const C = SETUP_COPY.unadded;

/** The registered project whose root contains `cwd`, compared by path segment (a display hint only). */
export function containingProject(
  cwd: string,
  projects: readonly ProjectDto[],
): ProjectDto | undefined {
  const norm = (p: string) => p.replace(/[\\/]+$/, '');
  const target = norm(cwd);
  return projects
    .filter((p) => {
      const root = norm(p.rootPath);
      return target === root || target.startsWith(`${root}/`) || target.startsWith(`${root}\\`);
    })
    .sort((a, b) => b.rootPath.length - a.rootPath.length)[0];
}

function AddButton({
  candidate,
  onResult,
}: {
  candidate: CandidateRootDto;
  onResult: (r: RegisterResult) => void;
}) {
  const { register, pending } = useRegisterProject();
  const name = baseName(candidate.cwd);
  return (
    <Button
      disabled={pending}
      aria-label={C.addAs(name)}
      title={C.addAs(name)}
      onClick={() => {
        void register({ name, rootPath: candidate.cwd }).then(onResult);
      }}
    >
      {pending ? C.adding : C.add}
    </Button>
  );
}

/**
 * Step 2 on Setup: folders where Claude Code ran that are not projects yet. Their sessions are not
 * read until the folder is added; one click adds it under its folder name.
 */
export function UnaddedFolders() {
  const candidates = useApiQuery(paths.candidates(), schemas.candidates);
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const [result, setResult] = useState<RegisterResult | null>(null);

  const columns: readonly Column<CandidateRootDto>[] = [
    {
      key: 'folder',
      label: SETUP_COPY.addProject.pathLabel,
      cell: (c) => <span className="font-mono text-caption break-all">{c.cwd}</span>,
    },
    {
      key: 'sessions',
      label: PAGES.sessions.title,
      align: 'right',
      cell: (c) => (
        <span className="whitespace-nowrap tabular-nums">{C.sessions(c.sessionCount)}</span>
      ),
    },
    {
      key: 'last',
      label: OVERVIEW_COPY.lastActivity,
      cell: (c) => <RelativeTime iso={c.lastSeenAt} fallback={C.noActivity} />,
    },
    {
      key: 'action',
      label: '',
      align: 'right',
      cell: (c) => {
        const owner = containingProject(c.cwd, projects.data ?? []);
        return owner ? (
          <span className="text-caption whitespace-nowrap text-dim">
            {C.insideProject} <a href={href.project(owner.id)}>{owner.name}</a>
          </span>
        ) : (
          <AddButton candidate={c} onResult={setResult} />
        );
      },
    },
  ];

  return (
    <QueryView query={candidates}>
      {(list) => (
        <div className="flex flex-col gap-3">
          {projects.error ? <ErrorNotice error={projects.error} /> : null}
          <RegisterNotice result={result} showInvalid />
          <DataTable
            label={C.title}
            columns={columns}
            rows={list}
            rowKey={(c) => `${c.provider}:${c.cwd}`}
            rowAttributes={(c) => ({ 'data-candidate': c.cwd })}
            empty={
              <EmptyState
                compact
                title={EMPTY.unaddedFolders.title}
                text={EMPTY.unaddedFolders.text}
              />
            }
          />
        </div>
      )}
    </QueryView>
  );
}
