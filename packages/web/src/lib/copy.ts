import type { SessionStatus } from '@acp/core';
import type { EventDto } from '@acp/core/api';
import { formatCount } from './format';
import type { TokenCategory } from './tokens';

/**
 * Every word the UI shows to explain itself, in one place (packages/web/DESIGN.md). Screens import
 * from here instead of writing their own labels, so a term reads the same everywhere and the
 * glossary tips stay in sync with the brief.
 */

/** What a missing value reads as. Missing is never 0 or blank (AGENTS.md §3.1). */
export const NOT_REPORTED = 'Not reported';

export const APP_NAME = 'Agent Control Plane';

export interface GlossaryEntry {
  /** The term as the UI shows it. */
  term: string;
  /** The info-tip text (ⓘ). */
  tip: string;
}

export type GlossaryKey =
  | 'session'
  | 'helperAgent'
  | 'project'
  | 'unaddedFolder'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheWriteTokens'
  | 'cacheReadTokens'
  | 'tokensThisSession'
  | 'tokensWithHelpers'
  | 'estimatedCost'
  | 'continued'
  | 'sharedMessages'
  | 'noKnownParent';

export const GLOSSARY: Readonly<Record<GlossaryKey, GlossaryEntry>> = {
  session: {
    term: 'Session',
    tip: 'One Claude Code conversation, from when it starts until it exits.',
  },
  helperAgent: {
    term: 'Helper agent',
    tip: 'A sub-agent that a session started to work on part of the task.',
  },
  project: {
    term: 'Project',
    tip: 'A folder you added. Sessions that ran inside it are shown here.',
  },
  unaddedFolder: {
    term: 'Unadded folder',
    tip: "A folder where Claude Code ran but that you haven't added as a project yet. Its sessions aren't read.",
  },
  inputTokens: {
    term: 'Input tokens',
    tip: 'Text sent to the model (your messages, files, tool results).',
  },
  outputTokens: { term: 'Output tokens', tip: 'Text the model wrote back.' },
  cacheWriteTokens: {
    term: 'Cache write tokens',
    tip: 'Input saved to the prompt cache so later turns can reuse it.',
  },
  cacheReadTokens: {
    term: 'Cache read tokens',
    tip: 'Input reused from the prompt cache; much cheaper than normal input.',
  },
  tokensThisSession: {
    term: 'Tokens (this session)',
    tip: 'Tokens used by this session itself.',
  },
  tokensWithHelpers: {
    term: 'Tokens (with helpers)',
    tip: 'This session plus all its helper agents.',
  },
  estimatedCost: {
    term: 'Estimated cost',
    tip: "Cost reported by Claude Code itself. An estimate; this app doesn't calculate prices.",
  },
  continued: {
    term: 'Continued from / as',
    tip: 'This session was resumed or forked from another one and shares its earlier messages.',
  },
  sharedMessages: {
    term: 'Shared messages',
    tip: 'Messages copied between sessions (resume/fork); each is counted only once.',
  },
  noKnownParent: {
    term: 'No known parent',
    tip: "Nothing we read says another session started this one. That doesn't prove nothing did.",
  },
};

/** "N messages were copied between sessions (resume/fork); each is counted only once." */
export function sharedMessagesText(n: number): string {
  const what = n === 1 ? '1 message was' : `${formatCount(n)} messages were`;
  return `${what} copied between sessions (resume/fork); each is counted only once.`;
}

export interface StatusCopy {
  word: string;
  tip: string;
}

/** There is no "completed": silence is "Inactive", only a reported end is "Ended". */
export const STATUS_COPY: Readonly<Record<SessionStatus, StatusCopy>> = {
  active: { word: 'Running', tip: 'Activity in the last 2 minutes.' },
  idle: { word: 'Paused', tip: 'No activity for 2–30 minutes.' },
  stale: {
    word: 'Inactive',
    tip: "No activity for over 30 minutes. Claude Code doesn't report finishing unless hooks are set up.",
  },
  ended: { word: 'Ended', tip: 'Claude Code reported that the session ended.' },
  unknown: { word: 'Unknown', tip: 'Not enough information yet.' },
};

export interface TokenTypeCopy {
  key: TokenCategory;
  /** Card / column label: "Input tokens". */
  label: string;
  /** Short label where the unit is already clear: "Input". */
  short: string;
  /** Unit after a number: "input tokens" (as in "1,540 input tokens"). */
  unit: string;
  tip: string;
}

/** The four token types, in display order. Shown side by side; never added into one total. */
export const TOKEN_TYPES: readonly TokenTypeCopy[] = [
  {
    key: 'input',
    label: GLOSSARY.inputTokens.term,
    short: 'Input',
    unit: 'input tokens',
    tip: GLOSSARY.inputTokens.tip,
  },
  {
    key: 'output',
    label: GLOSSARY.outputTokens.term,
    short: 'Output',
    unit: 'output tokens',
    tip: GLOSSARY.outputTokens.tip,
  },
  {
    key: 'cacheCreation',
    label: GLOSSARY.cacheWriteTokens.term,
    short: 'Cache write',
    unit: 'cache write tokens',
    tip: GLOSSARY.cacheWriteTokens.tip,
  },
  {
    key: 'cacheRead',
    label: GLOSSARY.cacheReadTokens.term,
    short: 'Cache read',
    unit: 'cache read tokens',
    tip: GLOSSARY.cacheReadTokens.tip,
  },
];

export function tokenType(key: TokenCategory): TokenTypeCopy {
  // TOKEN_TYPES lists every TokenCategory, so the lookup always succeeds.
  return TOKEN_TYPES.find((t) => t.key === key) as TokenTypeCopy;
}

/** Plain-words caveat when only some usage records reported a token type. */
export function partialNote(missing: number, total: number): string {
  const of = total > 0 ? ` of ${formatCount(total)}` : '';
  const records = missing === 1 && of === '' ? 'record' : 'records';
  return `${formatCount(missing)}${of} ${records} didn't report this, so the real number may be higher.`;
}

/** Page titles and their one-line descriptions (every page starts with one). */
export const PAGES = {
  overview: {
    title: 'Overview',
    description: 'What is running now, what used tokens, and what needs your attention.',
  },
  sessions: {
    title: 'Sessions',
    description: 'Every Claude Code session in your projects, and how they relate to each other.',
  },
  session: {
    title: 'Session',
    description: 'What this session did, the tokens it used, and the helper agents it started.',
  },
  tokens: {
    title: 'Tokens',
    description: 'Tokens used per day, model, project or session. Token types are never added up.',
  },
  projects: {
    title: 'Projects',
    description: 'Folders you added. Only sessions that ran inside them are read.',
  },
  project: {
    title: 'Project',
    description: 'Sessions that ran inside this folder and the tokens they used.',
  },
  setup: {
    title: 'Setup',
    description: 'Add project folders and, optionally, connect Claude Code hooks.',
  },
  health: {
    title: 'Data health',
    description: 'How well this app can read Claude Code, and anything it had to skip.',
  },
  notFound: {
    title: 'Page not found',
    description: 'There is nothing at this address.',
  },
} as const;

/** Sidebar labels. */
export const NAV_LABELS = {
  overview: PAGES.overview.title,
  sessions: PAGES.sessions.title,
  tokens: PAGES.tokens.title,
  projects: PAGES.projects.title,
  setup: PAGES.setup.title,
  health: PAGES.health.title,
} as const;

export const DEMO_BANNER = {
  title: "You're looking at sample data",
  text: 'Nothing here is real Claude Code activity. It comes from a built-in demo, kept apart from your real data.',
} as const;

/** Live-update connection words for the sidebar footer. */
export const CONNECTION_COPY = {
  open: { word: 'Live', tip: 'Updates appear as soon as Claude Code writes them.' },
  connecting: { word: 'Connecting', tip: 'Connecting to the local server for live updates.' },
  reconnecting: {
    word: 'Reconnecting',
    tip: 'The live connection dropped. Pages refresh once it is back.',
  },
  unsupported: {
    word: 'Live updates off',
    tip: "This browser can't receive live updates. Reload the page to see new activity.",
  },
} as const;

export const EMPTY = {
  sessions: {
    title: 'No sessions yet',
    text: 'Sessions appear here once Claude Code runs inside one of your projects.',
  },
  sessionsFiltered: {
    title: 'No matching sessions',
    text: 'No session matches these filters. Try clearing some of them.',
  },
  projects: {
    title: 'No projects yet',
    text: 'Add a folder where you use Claude Code. Its sessions will show up here.',
  },
  activity: {
    title: 'No activity yet',
    text: 'Things sessions do (messages, tools, helper agents) will be listed here.',
  },
  attention: {
    title: 'Nothing needs you',
    text: 'No session is waiting for your input.',
  },
  running: {
    title: 'Nothing running',
    text: 'No session has been active in the last 2 minutes.',
  },
  costs: {
    title: 'No cost reported yet',
    text: 'Claude Code has not reported an estimated cost for any recent session.',
  },
  tokens: {
    title: 'No token usage yet',
    text: 'Token counts appear once a session gets a reply from the model.',
  },
  unaddedFolders: {
    title: 'No unadded folders',
    text: 'Every folder where Claude Code ran is already a project, or none was found.',
  },
  helpers: {
    title: 'No helper agents',
    text: 'This session did not start any helper agents.',
  },
  notFound: { title: PAGES.notFound.title, text: PAGES.notFound.description },
} as const;

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function tokenCount(payload: Record<string, unknown>, key: 'input' | 'output'): number | null {
  const tokens = payload.tokens;
  if (typeof tokens !== 'object' || tokens === null) return null;
  const v = (tokens as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : null;
}

function usageSentence(payload: Record<string, unknown>): string {
  const input = tokenCount(payload, 'input');
  const output = tokenCount(payload, 'output');
  const part = (n: number | null, unit: string) =>
    n === null ? `${unit} not reported` : `${formatCount(n)} ${unit}`;
  return `Used ${part(input, 'input')} · ${part(output, 'output')} tokens`;
}

/**
 * The activity-feed sentence for one event (DESIGN.md, "Activity feed"). Reads only typed payload
 * fields (names, counts, flags), never content (ADR-0009). The switch is exhaustive, so a new
 * event type fails the typecheck until it has a sentence.
 */
export function describeEvent(event: Pick<EventDto, 'eventType' | 'payload'>): string {
  const p = event.payload;
  switch (event.eventType) {
    case 'message.user':
      return p.isMeta === true ? 'Claude Code added a message' : 'You sent a message';
    case 'message.assistant': {
      const model = str(p, 'model');
      return model ? `Claude replied (${model})` : 'Claude replied';
    }
    case 'usage.reported':
      return usageSentence(p);
    case 'tool.called': {
      const name = str(p, 'toolName');
      return name ? `Used tool: ${name}` : 'Used a tool';
    }
    case 'tool.result':
      return p.isError === true ? 'Tool failed' : 'Tool finished';
    case 'subagent.spawned': {
      const type = str(p, 'agentType');
      return type ? `Started a helper agent: ${type}` : 'Started a helper agent';
    }
    case 'subagent.stopped':
      return 'Helper agent finished';
    case 'session.observed':
      // Not in the brief's table: the first time a session's files were read.
      return 'Session found';
    case 'session.started':
      return 'Session started';
    case 'session.ended':
      return 'Session ended';
    case 'session.titled': {
      const title = str(p, 'title');
      return title ? `Named: ${title}` : 'Named';
    }
    case 'session.attention':
      return 'Waiting for you';
    case 'session.turn_ended':
      return 'Finished its turn';
    case 'session.cwd_changed':
      return 'Moved to another folder';
    case 'usage.snapshot':
      return 'Claude Code reported a running total';
    case 'provider.error': {
      const kind = str(p, 'kind');
      return kind ? `The model returned an error (${kind})` : 'The model returned an error';
    }
    case 'record.unrecognized':
      return 'Unknown record (skipped)';
  }
}
