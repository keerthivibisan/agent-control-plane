import type { CandidateRootDto, ProjectDto } from '@acp/core/api';
import { useState } from 'react';
import { QueryView } from '../../components/QueryView';
import { Time } from '../../components/Time';
import { paths, schemas } from '../../lib/api';
import { baseName, formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { RegisterResultNotice } from './RegisterProjectForm';
import { useRegisterProject, type RegisterResult } from './useRegisterProject';

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

function CandidateRow({
  candidate,
  projects,
  onRegistered,
}: {
  candidate: CandidateRootDto;
  projects: readonly ProjectDto[];
  onRegistered: (r: RegisterResult) => void;
}) {
  const { register, pending } = useRegisterProject();
  const owner = containingProject(candidate.cwd, projects);
  return (
    <tr className="border-b border-line/60 align-top" data-candidate={candidate.cwd}>
      <td className="py-1 pr-2 font-mono break-all">{candidate.cwd}</td>
      <td className="py-1 pr-2 font-mono">{candidate.provider}</td>
      <td className="py-1 pr-2 text-right font-mono">{formatCount(candidate.sessionCount)}</td>
      <td className="py-1 pr-2">
        <Time iso={candidate.lastSeenAt} fallback="unknown" />
      </td>
      <td className="py-1">
        {owner ? (
          <span className="text-dim">
            in <a href={href.project(owner.id)}>{owner.name}</a>
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              void register({ name: baseName(candidate.cwd), rootPath: candidate.cwd }).then(
                onRegistered,
              );
            }}
            className="rounded border border-accent px-1.5 text-[11px] text-accent hover:bg-sunken disabled:opacity-50"
            title={`Register ${candidate.cwd} as project "${baseName(candidate.cwd)}"`}
          >
            {pending ? 'registering…' : 'register'}
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * Working directories where provider sessions were discovered but no project is registered.
 * Sessions there are not ingested until their root is registered.
 */
export function CandidateRoots() {
  const candidates = useApiQuery(paths.candidates(), schemas.candidates);
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const [result, setResult] = useState<RegisterResult | null>(null);
  return (
    <QueryView query={candidates} loading="Looking for discovered roots…">
      {(list) =>
        list.length === 0 ? (
          <p className="text-dim italic">
            No candidate roots discovered. Register a repository root above by path.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <RegisterResultNotice result={result} />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="text-[11px] text-dim">
                  <tr className="border-b border-line">
                    <th className="py-1 pr-2 font-medium">Discovered working directory</th>
                    <th className="py-1 pr-2 font-medium">Provider</th>
                    <th className="py-1 pr-2 text-right font-medium">Sessions</th>
                    <th className="py-1 pr-2 font-medium">Last seen</th>
                    <th className="py-1 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <CandidateRow
                      key={`${c.provider}:${c.cwd}`}
                      candidate={c}
                      projects={projects.data ?? []}
                      onRegistered={setResult}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }
    </QueryView>
  );
}
