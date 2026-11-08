import { CODE_MAP_SEARCH_MAX_QUERY, type CodeMapSearchMatch } from '@acp/core/api';
import { useEffect, useId, useState } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { CloseIcon, SearchIcon } from '../../components/icons';
import { inputClass } from '../../components/Input';
import { codeMapPaths, codeMapSchemas } from '../../lib/api';
import { CODE_MAP_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';

const S = CODE_MAP_COPY.search;
export const SEARCH_DEBOUNCE_MS = 250;

function matchKey(m: CodeMapSearchMatch, i: number): string {
  return `${m.kind}:${m.path}:${m.name ?? ''}:${m.line ?? ''}:${i}`;
}

/**
 * Search the map's files and symbols (`GET …/code-map/search?q=`), 250 ms after typing stops.
 * Each result is a button (Tab reaches it) that opens the file; names and paths are text only.
 */
export function SearchBox({
  projectId,
  onPick,
  debounceMs = SEARCH_DEBOUNCE_MS,
}: {
  projectId: string;
  onPick: (path: string) => void;
  debounceMs?: number;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = text.trim();
    if (q === '') return;
    const timer = setTimeout(() => setDebounced(q), debounceMs);
    return () => clearTimeout(timer);
  }, [text, debounceMs]);
  // Cleared at once; a new query only after typing stops.
  const query = text.trim() === '' ? '' : debounced;

  const result = useApiQuery(
    query === '' ? null : codeMapPaths.search(projectId, query),
    codeMapSchemas.search,
  );
  const data = result.data?.query === query ? result.data : undefined;
  const showList = open && query !== '';

  const pick = (path: string) => {
    setOpen(false);
    onPick(path);
  };

  return (
    <div
      className="relative w-full max-w-md"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <label htmlFor={id} className="sr-only">
        {S.label}
      </label>
      <SearchIcon
        size={16}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-dim"
      />
      <input
        id={id}
        type="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={CODE_MAP_SEARCH_MAX_QUERY}
        placeholder={S.placeholder}
        value={text}
        className={inputClass('w-full pr-8 pl-8')}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {text !== '' ? (
        <button
          type="button"
          aria-label={S.clear}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-control p-1 text-dim hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          onClick={() => {
            setText('');
            setOpen(false);
          }}
        >
          <CloseIcon size={14} />
        </button>
      ) : null}
      {showList ? (
        <div
          id={`${id}-results`}
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-96 overflow-y-auto rounded-overlay border border-line bg-panel-raised p-1 shadow-pop"
          data-testid="code-map-search-results"
        >
          {result.error !== null && data === undefined ? (
            <div className="p-2">
              <ErrorNotice error={result.error} />
            </div>
          ) : data === undefined ? (
            <p className="p-2 text-caption text-dim">{S.searching}</p>
          ) : data.matches.length === 0 ? (
            <p className="p-2 text-caption text-dim">{S.none}</p>
          ) : (
            <>
              <ul aria-label={S.results} className="flex flex-col">
                {data.matches.map((m, i) => (
                  <li key={matchKey(m, i)}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 rounded-control px-2 py-1.5 text-left hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                      data-testid="code-map-search-match"
                      data-kind={m.kind}
                      onClick={() => pick(m.path)}
                    >
                      {m.kind === 'symbol' ? (
                        <>
                          <span className="flex w-full min-w-0 items-baseline gap-2">
                            <code className="min-w-0 truncate font-mono text-caption font-medium text-ink">
                              {m.name}
                            </code>
                            <span className="shrink-0 text-micro text-dim">
                              {m.symbolKind ?? S.symbol}
                            </span>
                          </span>
                          <span className="w-full truncate font-mono text-micro text-dim">
                            {m.line === null ? m.path : `${m.path}:${m.line}`}
                          </span>
                        </>
                      ) : (
                        <span className="flex w-full min-w-0 items-baseline gap-2">
                          <code className="min-w-0 truncate font-mono text-caption text-ink">
                            {m.path}
                          </code>
                          <span className="shrink-0 text-micro text-dim">{S.file}</span>
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {data.truncated ? (
                <p className="px-2 py-1 text-micro text-dim">
                  {S.more(data.matches.length, data.total)}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
