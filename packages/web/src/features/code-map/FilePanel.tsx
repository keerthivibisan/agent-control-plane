import type { CodeMapFileDto } from '@acp/core/api';
import { useState, type ReactNode } from 'react';
import { Badge } from '../../components/Pill';
import { Button } from '../../components/Button';
import { ErrorNotice } from '../../components/ErrorNotice';
import { CloseIcon } from '../../components/icons';
import { LoadingBlock } from '../../components/Skeleton';
import { codeMapPaths, codeMapSchemas } from '../../lib/api';
import { CODE_MAP_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';

const F = CODE_MAP_COPY.file;
/** Long lists show this many rows until "Show all". */
const FIRST = 50;

/** `2.4 KB`: sizes in the file panel (1 KB = 1024 bytes, like the 512 KiB cap). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${formatCount(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line px-4 py-3" aria-label={title}>
      <h3 className="mb-2 flex items-baseline gap-2 text-caption font-semibold text-ink">
        {title}
        <span className="font-normal text-dim tabular-nums">{formatCount(count)}</span>
      </h3>
      {children}
    </section>
  );
}

/** The first rows of a long list, with "Show all". */
function useFirst<T>(items: readonly T[]): { shown: readonly T[]; more: ReactNode } {
  const [all, setAll] = useState(false);
  if (all || items.length <= FIRST) return { shown: items, more: null };
  return {
    shown: items.slice(0, FIRST),
    more: (
      <Button size="sm" variant="quiet" className="mt-1" onClick={() => setAll(true)}>
        {F.showAll(items.length)}
      </Button>
    ),
  };
}

/** A repository path as a button that opens that file's details. Text only, never a link out. */
function PathButton({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  return (
    <button
      type="button"
      className="w-full truncate rounded-control px-1.5 py-0.5 text-left font-mono text-micro text-accent hover:bg-hover hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      title={path}
      aria-label={F.open(path)}
      onClick={() => onOpen(path)}
    >
      {path}
    </button>
  );
}

function PathList({
  paths,
  empty,
  onOpen,
  label,
}: {
  paths: readonly string[];
  empty: string;
  onOpen: (path: string) => void;
  label: string;
}) {
  const { shown, more } = useFirst(paths);
  if (paths.length === 0) return <p className="text-caption text-dim">{empty}</p>;
  return (
    <>
      <ul aria-label={label} className="flex flex-col">
        {shown.map((p) => (
          <li key={p}>
            <PathButton path={p} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      {more}
    </>
  );
}

function Symbols({ dto }: { dto: CodeMapFileDto }) {
  const { shown, more } = useFirst(dto.file.symbols);
  return (
    <Section title={F.symbols} count={dto.file.symbols.length}>
      {dto.file.symbols.length === 0 ? (
        <p className="text-caption text-dim">{F.noSymbols}</p>
      ) : (
        <>
          <ul aria-label={F.symbols} className="flex flex-col gap-0.5">
            {shown.map((s, i) => (
              <li
                key={`${s.line}:${s.name}:${i}`}
                className="flex items-center gap-2 text-caption"
                data-testid="code-map-symbol"
              >
                <code className="min-w-0 truncate font-mono text-micro text-ink" title={s.name}>
                  {s.name}
                </code>
                <span className="shrink-0 text-micro text-dim">{s.kind}</span>
                <span className="shrink-0 text-micro text-dim tabular-nums">{F.line(s.line)}</span>
                {s.exported ? (
                  <span className="ml-auto shrink-0">
                    <Badge tone="accent">{F.exported}</Badge>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {more}
        </>
      )}
    </Section>
  );
}

function Imports({ dto, onOpen }: { dto: CodeMapFileDto; onOpen: (path: string) => void }) {
  const resolved = [
    ...new Set(dto.file.imports.flatMap((i) => (i.resolvedPath === null ? [] : [i.resolvedPath]))),
  ].sort();
  const unresolved = dto.file.imports.filter((i) => i.resolvedPath === null);
  return (
    <Section title={F.imports} count={resolved.length}>
      <PathList paths={resolved} empty={F.noImports} onOpen={onOpen} label={F.imports} />
      {unresolved.length > 0 ? (
        <div className="mt-2" data-testid="code-map-unresolved">
          <p className="text-caption text-dim">{F.unresolved(unresolved.length)}</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {unresolved.map((i, n) => (
              <li key={`${i.specifier}:${n}`}>
                <code
                  className="inline-block max-w-full truncate rounded-[3px] border border-line bg-subtle px-1 font-mono text-micro text-dim"
                  title={i.specifier}
                >
                  {i.specifier}
                </code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

/**
 * One file's details (`GET …/code-map/file?path=`): its facts, symbols, imports, the files that
 * import it and the tests among them. Paths and names are repository data: rendered as text, and
 * a path only ever opens another file of the map.
 */
export function FilePanel({
  projectId,
  path,
  onOpen,
  onClose,
}: {
  projectId: string;
  path: string;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const query = useApiQuery(codeMapPaths.file(projectId, path), codeMapSchemas.file);
  const missing = query.error !== null && query.error.kind === 'http' && query.error.status === 404;
  const dto = query.data?.file.path === path ? query.data : undefined;

  return (
    <aside
      aria-label={F.label}
      data-testid="code-map-file-panel"
      className="min-w-0 self-start rounded-card border border-line bg-panel shadow-card"
    >
      <header className="flex items-start gap-2 rounded-t-[calc(var(--radius-card)-1px)] bg-subtle px-4 py-3">
        <h2 className="min-w-0 flex-1 font-mono text-caption font-semibold break-all text-ink">
          {path}
        </h2>
        <Button size="sm" variant="quiet" aria-label={F.close} onClick={onClose}>
          <CloseIcon size={16} />
        </Button>
      </header>
      {dto === undefined ? (
        <div className="border-t border-line p-4">
          {missing ? (
            <p className="text-caption text-dim">{F.notFound}</p>
          ) : query.error !== null ? (
            <ErrorNotice error={query.error} />
          ) : (
            <LoadingBlock label={F.loading} />
          )}
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-caption">
            <dt className="text-dim">{F.language}</dt>
            <dd>{dto.file.language}</dd>
            <dt className="text-dim">{F.size}</dt>
            <dd className="tabular-nums">{formatBytes(dto.file.sizeBytes)}</dd>
            <dt className="text-dim">{F.lines}</dt>
            <dd className="tabular-nums">{formatCount(dto.file.lineCount)}</dd>
            {dto.file.isTest ? (
              <>
                <dt className="text-dim">{F.test}</dt>
                <dd>
                  <Badge>{CODE_MAP_COPY.graph.test}</Badge>
                </dd>
              </>
            ) : null}
          </dl>
          {dto.file.skipped !== null ? (
            <p
              className="border-t border-line px-4 py-3 text-caption text-warning"
              data-testid="code-map-skipped"
            >
              <strong className="font-semibold">{F.skipped}: </strong>
              {F.skipReasons[dto.file.skipped.reason]}
            </p>
          ) : null}
          <Symbols dto={dto} />
          <Imports dto={dto} onOpen={onOpen} />
          <Section title={F.importedBy} count={dto.importedBy.length}>
            <PathList
              paths={dto.importedBy}
              empty={F.noImportedBy}
              onOpen={onOpen}
              label={F.importedBy}
            />
          </Section>
          <Section title={F.tests} count={dto.tests.length}>
            <PathList paths={dto.tests} empty={F.noTests} onOpen={onOpen} label={F.tests} />
          </Section>
        </>
      )}
    </aside>
  );
}
