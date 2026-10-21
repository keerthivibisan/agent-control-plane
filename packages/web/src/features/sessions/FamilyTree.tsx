import type { SessionTreeDto } from '@acp/core/api';
import { InfoTip } from '../../components/InfoTip';
import { QueryView } from '../../components/QueryView';
import { StatusBadge } from '../../components/StatusBadge';
import { paths, schemas } from '../../lib/api';
import { GLOSSARY, helperAgentsText, SESSIONS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { buildFamily, type FamilyMember } from './family';
import { nameSession, sessionName } from '../../lib/session-name';
import { SessionNameExtra, TokenSummary } from './session-bits';

const COPY = SESSIONS_COPY.family;

/** The session to outline, and the word next to it ("This session" / "Selected"). */
interface Current {
  id: string | undefined;
  label: string;
}

// Connector geometry: the vertical line runs down the left of a branch; each child gets a short
// horizontal line to the middle of its card's first row.
const BRANCH = 'relative pt-3 pl-7';
const VERTICAL = 'before:absolute before:top-0 before:left-0 before:h-full before:border-l-2';
const LAST_VERTICAL = 'last:before:h-[2.05rem]';
const ELBOW = 'after:absolute after:top-[2.05rem] after:left-0 after:w-6 after:border-t-2';

function MemberCard({
  m,
  current: currentProps,
  top,
}: {
  m: FamilyMember;
  current: Current;
  /** A top-level session (the one that started the others): framed in ink, as the controller. */
  top: boolean;
}) {
  const s = m.session;
  const current = s.id === currentProps.id;
  const naming = nameSession(s);
  return (
    <div
      data-testid={`family-member-${s.id}`}
      data-current={current ? 'true' : undefined}
      // Square, like every agent node (DESIGN.md, "Agent views"): the session outlined has the
      // brand's lime ring, a top-level session an ink frame, the others a hairline.
      className={`relative max-w-xl rounded-[2px] border bg-panel px-4 py-3 shadow-card transition-colors ${
        current
          ? `ring-3 ring-accent-fill/55 dark:ring-accent-fill/25 ${
              top ? 'border-ink' : 'border-accent-fill-edge'
            }`
          : top
            ? 'border-ink/70 hover:border-ink'
            : 'border-line hover:border-line-strong'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* The link covers the whole card (after:inset-0), so the card is one big target. */}
        <a
          href={href.session(s.id)}
          aria-current={current ? 'page' : undefined}
          className="min-w-0 flex-1 truncate font-medium text-ink no-underline after:absolute after:inset-0 after:rounded-[2px] hover:underline"
        >
          {naming.name}
        </a>
        <StatusBadge status={s.status} withTip={false} />
      </div>
      <SessionNameExtra naming={naming} />
      <div className="mt-1 text-caption">
        <TokenSummary usage={s.directUsage} withCache={false} compact={false} />
      </div>
      {current || m.noKnownParent || s.childCount > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-dim">
          {current ? <span className="font-medium text-accent">{currentProps.label}</span> : null}
          {s.childCount > 0 ? (
            <span>{helperAgentsText(s.childCount) ?? SESSIONS_COPY.table.noHelpers}</span>
          ) : null}
          {m.noKnownParent ? (
            // Above the card-wide link, so the tip can be opened on its own.
            <span className="relative z-10 inline-flex items-center gap-0.5">
              <span data-testid="family-no-known-parent">{GLOSSARY.noKnownParent.term}</span>
              <InfoTip tip={GLOSSARY.noKnownParent.tip} label={GLOSSARY.noKnownParent.term} />
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Branch({ m, current, top = false }: { m: FamilyMember; current: Current; top?: boolean }) {
  return (
    <div>
      <MemberCard m={m} current={current} top={top} />
      {m.helpers.length > 0 ? (
        <ul
          className="ml-5"
          aria-label={`${SESSIONS_COPY.table.helpers}: ${sessionName(m.session)}`}
        >
          {m.helpers.map((h) => (
            <li
              key={h.session.id}
              className={`${BRANCH} ${VERTICAL} ${LAST_VERTICAL} ${ELBOW} before:border-line-strong after:border-line-strong`}
            >
              <Branch m={h} current={current} />
            </li>
          ))}
        </ul>
      ) : null}
      {m.continuedAs.length > 0 ? (
        <ul
          className="ml-5"
          aria-label={`${SESSIONS_COPY.relate.legend.continuation}: ${sessionName(m.session)}`}
        >
          {m.continuedAs.map((c) => (
            <li
              key={c.session.id}
              data-testid="family-continued-as"
              className={`${BRANCH} ${VERTICAL} ${LAST_VERTICAL} ${ELBOW} before:border-dashed before:border-dim/50 after:border-dashed after:border-dim/50`}
            >
              <span className="mb-1 block text-caption font-medium text-dim">
                {SESSIONS_COPY.relate.legend.continuation}
              </span>
              <Branch m={c} current={current} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * "Which session is under which", for anyone: the top-level session at the top, the helper agents
 * it started nested beneath it with connecting lines, and a dashed "Continued as" link to the
 * sessions it was continued in. Only the tree's evidence edges are used.
 */
export function FamilyTree({
  tree,
  currentId,
  currentLabel = COPY.thisSession,
}: {
  tree: SessionTreeDto;
  currentId?: string | undefined;
  currentLabel?: string;
}) {
  const family = buildFamily(tree);
  const current = { id: currentId, label: currentLabel };
  return (
    <ul aria-label={COPY.label} className="flex flex-col gap-6" data-testid="family-tree">
      {family.map((m) => (
        <li key={m.session.id}>
          <Branch m={m} current={current} top />
        </li>
      ))}
    </ul>
  );
}

/**
 * Loads `/sessions/:id/tree` and draws its family tree, outlining `sessionId` (unless it is the
 * top of the tree and `outlineRoot` is false, where an outline would add nothing).
 */
export function SessionFamily({
  sessionId,
  currentLabel,
  outlineRoot = true,
}: {
  sessionId: string;
  currentLabel?: string;
  outlineRoot?: boolean;
}) {
  const tree = useApiQuery(paths.sessionTree(sessionId), schemas.sessionTree);
  return (
    <QueryView query={tree} loading={SESSIONS_COPY.relate.loading}>
      {(t) => (
        <FamilyTree
          tree={t}
          currentId={outlineRoot || t.rootId !== sessionId ? sessionId : undefined}
          {...(currentLabel ? { currentLabel } : {})}
        />
      )}
    </QueryView>
  );
}
