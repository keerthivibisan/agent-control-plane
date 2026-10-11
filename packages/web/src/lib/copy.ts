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

// --- Tokens, Projects and Project pages (phase 2, wp/ui-tokens) ---------------------------------

/** "1 session" / "12 sessions": a count with its noun, so a number never stands alone. */
export function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : plural}`;
}

export type UsageGroupWord = 'project' | 'session' | 'model' | 'day';
export type DatePreset = '7d' | '30d' | 'all' | 'custom';

const GROUP_WORDS: Readonly<Record<UsageGroupWord, string>> = {
  project: 'Project',
  session: 'Session',
  model: 'Model',
  day: 'Day',
};

/** Wording for the Tokens page (`#/usage`). */
export const TOKENS_PAGE = {
  explainer: {
    title: 'What the four token types mean',
    intro:
      'A token is a small piece of text, roughly part of a word. Claude Code reports how many tokens each reply used, in four types:',
    why: 'They are priced differently (cache read is much cheaper than normal input), so this app always shows them side by side and never adds them into one total.',
    hide: 'Hide',
    show: 'What do these mean?',
  },
  filters: {
    label: 'Token filters',
    dates: 'Dates',
    presets: {
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
      all: 'All time',
      custom: 'Custom',
    } satisfies Record<DatePreset, string>,
    from: 'From',
    to: 'To',
    utcNote: 'Days are counted in UTC.',
    project: 'Project',
    allProjects: 'All projects',
    groupBy: 'Group by',
    clear: 'Clear filters',
  },
  groupWords: GROUP_WORDS,
  stats: {
    label: 'Tokens in the selected range',
    notReportedNote: 'No usage record in this range reported this type.',
  },
  charts: {
    title: 'Tokens per day',
    inputOutput: 'Input and output tokens per day',
    cache: 'Prompt cache tokens per day',
    note: 'Lines are not stacked. A gap means that day did not report this type; it is not zero. Days with no usage are left out.',
    showTable: 'Show as table',
    showChart: 'Show as chart',
    dayAxis: 'Day (UTC)',
    tokensAxis: 'Tokens',
    tableLabel: 'Tokens per day',
  },
  undated: (n: number) =>
    n === 1
      ? '1 usage record has no date, so it is not on the charts. It is included in the numbers above and the table below.'
      : `${formatCount(n)} usage records have no date, so they are not on the charts. They are included in the numbers above and the table below.`,
  breakdown: {
    title: (group: UsageGroupWord) => `Tokens by ${GROUP_WORDS[group].toLowerCase()}`,
    countedOnce:
      "Each session's own tokens are counted once; helper agents count under themselves.",
    sortedByDay: 'Newest day first.',
    sortedByOutput: 'Most output tokens first.',
    partial: 'Partial',
  },
  cost: {
    text: "Looking for cost? Each session's page shows the estimated cost Claude Code reported.",
    link: 'Go to sessions',
  },
  emptyRange: {
    title: 'No token usage in this range',
    text: 'Try a longer date range or another project.',
  },
} as const;

/** Wording for the Projects list (`#/projects`). */
export const PROJECTS_PAGE = {
  add: 'Add a project',
  tableLabel: 'Projects',
  columns: {
    project: 'Project',
    folder: 'Folder',
    sessions: 'Sessions',
    running: 'Running now',
    lastActivity: 'Last activity',
  },
  sessions: (n: number) => countOf(n, 'session'),
  running: (n: number) => (n === 0 ? 'None' : `${formatCount(n)} running`),
  noActivity: 'No activity yet',
} as const;

/** Wording for one project's page (`#/projects/:id`). */
export const PROJECT_PAGE = {
  back: 'All projects',
  folder: 'Folder',
  lastActivity: 'Last activity',
  tokens: {
    title: 'Tokens used in this project',
    description:
      "All time. Each session's own tokens, counted once; helper agents count under themselves.",
  },
  seeTokens: 'See tokens by day',
  openInTokens: 'Open in Tokens',
  sessions: {
    title: 'Sessions in this project',
    columns: {
      session: 'Session',
      status: 'Status',
      helpers: 'Helper agents',
      tokens: 'Tokens (this session)',
      lastActivity: 'Last activity',
    },
    isHelper: 'Helper agent',
    helpers: (n: number) => (n === 0 ? 'None' : countOf(n, 'helper agent')),
    empty: {
      title: 'No sessions yet',
      text: 'Sessions appear here once Claude Code runs inside this folder.',
    },
  },
  pager: {
    label: 'Pages',
    first: 'First page',
    previous: 'Previous',
    next: 'Next',
    page: (n: number) => `Page ${formatCount(n)}`,
    updating: 'Updating…',
  },
} as const;

/* -------------------------------------------------------------------------------------------- */
/* Overview, Setup and Data health screens (phase 2, wp/ui-overview). Add-only section.          */
/* -------------------------------------------------------------------------------------------- */

/** "1 helper agent" / "3 helper agents"; null when there are none (rows then say nothing). */
export function helperAgentsText(n: number): string | null {
  return n === 0 ? null : countOf(n, 'helper agent', 'helper agents');
}

export const OVERVIEW_COPY = {
  stats: {
    running: { label: 'Running now', tip: STATUS_COPY.active.tip },
    needYou: {
      label: 'Need you',
      tip: 'Sessions where Claude Code said it is waiting for your input. This needs live updates (see Setup).',
    },
    projects: { label: 'Projects', tip: GLOSSARY.project.tip },
    seeAll: 'See all',
  },
  statusCard: {
    title: 'Sessions by status',
    description: 'Every session in your projects, grouped by what it is doing now.',
  },
  tokens: {
    title: 'Tokens used',
    description:
      'All sessions in your projects, each counted once. Token types are priced differently, so they are shown side by side and never added up.',
    link: 'Tokens over time',
  },
  running: {
    title: 'Running now',
    description: 'Sessions with activity in the last 2 minutes.',
    link: 'All running sessions',
  },
  waiting: {
    title: 'Waiting for you',
    description: 'Sessions where Claude Code asked for your input.',
    asked: 'Asked',
    noHooksTitle: 'Live updates are off',
    noHooksText:
      'Claude Code can only tell this app that a session is waiting for you through hooks. Until they are set up, this list stays empty.',
    noHooksAction: 'Set up live updates',
  },
  costs: {
    title: 'Estimated cost by session',
    description:
      'The latest cost Claude Code reported for each recent session. Claude Code makes this estimate, not this app, and the costs are never added together.',
    asOf: 'as of',
    scope: 'What the total covers',
  },
  activity: {
    title: 'Recent activity',
    description: 'The latest things your sessions did, newest first.',
    raw: 'Technical details: raw events',
    unknownSession: 'Not linked to a session',
  },
  getStarted: {
    title: 'Add your first project',
    text: 'This app only reads Claude Code sessions that ran inside folders you add. Add a folder to get started.',
    action: 'Add a project folder',
    found: (n: number) =>
      `${countOf(n, 'folder', 'folders')} with Claude Code activity ${n === 1 ? 'was' : 'were'} found and can be added in one click.`,
  },
  sessions: (n: number) => countOf(n, 'session', 'sessions'),
  folders: (n: number) => countOf(n, 'folder', 'folders'),
  untitled: 'Untitled session',
  noProject: 'No project',
  lastActivity: 'Last activity',
  noActivity: 'No activity yet',
  /** Link text for a session known only by its id. */
  sessionById: (shortId: string) => `Session ${shortId}`,
} as const;

/** Column labels inside "Technical details" on the Overview, Setup and Data health pages. */
export const TECH_LABELS = {
  sessionId: 'Session id',
  eventId: 'Event id',
  eventType: 'Event type',
  scope: 'Scope',
  reportedAt: 'Reported at',
  occurredAt: 'Occurred at',
  provenance: 'Provenance',
  channel: 'Channel',
  provider: 'Provider',
  costReports: 'Cost reports',
  rawEvents: 'Raw events',
  file: 'File',
  reason: 'Reason',
  detail: 'Detail',
  recordType: 'Record type',
  version: 'Version',
  count: 'Count',
  parseErrors: 'Parse errors',
  bytesRead: 'Bytes read',
  size: 'Size (bytes)',
  updatedAt: 'Updated at',
  counter: 'Counter',
  value: 'Value',
  receiverUrl: 'Receiver URL',
} as const;

export const SETUP_COPY = {
  heading: 'Connect this app to your work',
  description:
    'Add the folders where you use Claude Code. Optionally, turn on live updates so the app knows the moment a session needs you.',
  step: (n: number) => `Step ${n}`,
  optional: 'Optional',
  addProject: {
    title: 'Add a project folder',
    description:
      'Only sessions that ran inside a folder you add are read. Nothing outside it is opened.',
    nameLabel: 'Name',
    nameHint: 'Any name you like, for example the repository name.',
    namePlaceholder: 'my-app',
    pathLabel: 'Folder path',
    pathHint: 'The full path, starting with / (or a drive letter on Windows).',
    pathPlaceholder: '/Users/me/code/my-app',
    submit: 'Add project',
    submitting: 'Adding…',
    /** Accessible name of the form. */
    formLabel: 'Register a project',
    added: (name: string) => `Added ${name}.`,
    addedText: 'Its sessions will show up in a few seconds.',
    open: 'Open project',
  },
  unadded: {
    title: 'Folders with Claude Code activity, not added yet',
    description:
      "Claude Code ran in these folders, but they aren't projects yet, so their sessions aren't read. Add one with a click.",
    add: 'Add',
    adding: 'Adding…',
    addAs: (name: string) => `Add as project "${name}"`,
    insideProject: 'Inside project',
    noActivity: 'No activity seen',
    sessions: (n: number) => countOf(n, 'session', 'sessions'),
  },
  hooks: {
    title: 'Live updates through hooks',
    description:
      'Hooks are a Claude Code feature that sends this app a short note when something happens. Everything else works without them.',
    whatTheyAdd: 'What hooks add',
    benefits: [
      '"Waiting for you" appears the moment a session asks for your input.',
      'Sessions show "Ended" when they really end, instead of turning "Inactive" after 30 minutes.',
      'Helper agents and finished turns show up right away.',
    ],
    neverEdits:
      'This app never edits your Claude Code settings. You add the hooks yourself and can remove them at any time.',
    receiverLabel: 'This app listens for hooks at',
    stepsTitle: 'How to turn them on',
    steps: {
      print: 'In this repository, print the hook settings:',
      paste:
        'Paste the printed "hooks" block into your own Claude Code settings file (for example ~/.claude/settings.json).',
      token:
        'Set the ACP_HOOK_TOKEN environment variable, where Claude Code runs, to the contents of the hook-token file in this app’s data folder. The command above prints where that file is.',
      restart: 'Start a new Claude Code session. The first hook arrives after its first reply.',
    },
    command: 'pnpm --filter @acp/server hooks:snippet',
    serverDown:
      'If this app is not running, Claude Code may show a small hook error. It never blocks your work.',
    received: 'Connected: this app has received hooks from Claude Code.',
    notReceived: 'Not connected yet: no hook has been received.',
    demo: 'Sample data does not accept hooks. Start the app normally to connect them.',
    commandName: 'command',
    receiverName: 'hook address',
  },
  copy: {
    action: (what: string) => `Copy ${what}`,
    copied: 'Copied',
    failed: "Couldn't copy",
  },
  errors: {
    nameMissing: 'Give the project a name.',
    nameTooLong: 'Use a shorter name (at most 200 characters).',
    pathMissing: 'Enter the folder path.',
    pathNotAbsolute:
      'Use the full folder path, starting with / (for example /Users/me/code/my-app).',
    notFound:
      "That folder wasn't found on this computer, or it isn't a folder. Check the path and try again.",
    duplicate: 'This folder is already a project.',
    generic: "The folder couldn't be added.",
  },
} as const;

/** Plain words for an adapter file-issue reason (docs/provider-adapters.md §8). */
export const FILE_ISSUE_REASONS: Readonly<Record<string, string>> = {
  'size-cap': 'Too large to read, so it was skipped.',
  'io-error': "Couldn't be opened or read.",
  'invalid-meta': "A helper agent's description file is damaged, so its parent is unknown.",
  'outside-projects': 'Points outside the Claude Code data folder, so it was not read.',
  'symlink-mismatch': 'A link that points somewhere unexpected, so it was not read.',
  'not-regular-file': 'Not a regular file, so it was not read.',
};

export function fileIssueText(reason: string): string {
  return FILE_ISSUE_REASONS[reason] ?? `Skipped (${reason}).`;
}

export const HEALTH_COPY = {
  heading: 'Is the data trustworthy?',
  allGood: (files: number) => `All good: ${countOf(files, 'file', 'files')} read, no problems.`,
  allGoodText:
    'Everything this app tracks was read without errors. Anything it skips on purpose is listed below.',
  attention: (n: number) => `${countOf(n, 'thing needs', 'things need')} a look`,
  attentionText:
    'The app kept working, but some data could not be read, so some numbers elsewhere may be low.',
  firstRead: 'Getting ready',
  firstReadText: 'This app has not finished its first check for Claude Code activity yet.',
  summaryLabel: 'Summary',
  problems: {
    fileIssues: (n: number) => countOf(n, 'file could not be read', 'files could not be read'),
    parseErrors: (n: number) => countOf(n, 'line could not be read', 'lines could not be read'),
    unknownRecords: (n: number) =>
      countOf(n, 'record of an unknown kind', 'records of an unknown kind'),
    pollErrors: (n: number) =>
      countOf(n, 'check for new activity failed', 'checks for new activity failed'),
    failedBatches: (n: number) =>
      countOf(n, 'batch of updates was not saved', 'batches of updates were not saved'),
    invalidEvents: (n: number) =>
      countOf(n, 'update was rejected as invalid', 'updates were rejected as invalid'),
  },
  files: {
    title: 'Files that could not be read',
    description: 'From the latest scan. Sessions in these files may be missing or incomplete.',
    none: 'Every file was readable.',
  },
  skipped: {
    title: 'Known, skipped on purpose',
    tip: 'Claude Code writes some records that carry nothing this app uses (for example file snapshots). They are recognized, counted and skipped, never stored.',
    description: 'Records this app recognizes and skips because they carry nothing it uses.',
    none: 'Nothing was skipped.',
    count: (n: number) => countOf(n, 'record', 'records'),
  },
  unknown: {
    title: 'Unknown records',
    tip: 'Records of a kind this app does not recognize, perhaps from a newer Claude Code version. They are counted, not interpreted.',
    description: 'Records of a kind this app does not recognize. Counted, not interpreted.',
    none: 'Every record was of a known kind.',
    noType: 'Record without a type',
    version: (v: string | null) =>
      v === null ? 'Claude Code version not reported' : `Claude Code ${v}`,
  },
  parse: {
    title: 'Lines that could not be read',
    description: 'Damaged or incomplete lines in session files. They were skipped.',
    none: 'No damaged lines.',
    bySource: (provider: string, n: number) =>
      `${provider}: ${countOf(n, 'line', 'lines')} skipped since the app started`,
    fileChanged: 'file last changed',
  },
  reading: {
    title: 'Reading activity',
    description: 'How this app checks for new activity, since it was last started.',
    polls: 'Checks for new activity',
    lastPoll: 'Last check',
    notYet: 'Not yet',
    pollErrors: 'Failed checks',
    failedBatches: 'Updates not saved',
    failedBatchesTip:
      'Batches of updates that were rolled back. Their files are read again on the next check.',
    invalidEvents: 'Updates rejected as invalid',
    filesTracked: 'Files tracked',
    edgeConflicts: 'Conflicting parent information',
    edgeConflictsTip: 'Two files named different parents for one session. The first one was kept.',
    usageConflicts: 'Conflicting token reports',
    usageConflictsTip:
      'Copies of one reply reported different token counts. The one with the most output was kept.',
  },
  capabilities: {
    title: 'What this app can see',
    description: 'What each source of sessions provides, and what it cannot tell this app.',
    providerName: (p: string) =>
      p === 'claude-code' ? 'Claude Code' : p === 'demo' ? 'Sample data' : p,
    observation: {
      transcripts: 'Session files (messages, tools, tokens)',
      lifecycleHooks: 'Live updates through hooks',
      subagentRelationships: 'Which session started which helper agent',
      perTurnUsage: 'Tokens for each reply',
      cumulativeSnapshots: 'Running totals and estimated cost from Claude Code',
    },
    yes: 'Yes',
    no: 'No',
    versions: 'Claude Code versions seen',
    noVersions: 'None yet',
    limitations: 'Good to know',
    limitationsCount: (n: number) => `Good to know: ${countOf(n, 'known limit', 'known limits')}`,
    hooksReceived: 'Hooks received',
  },
  raw: 'Technical details: raw counters',
} as const;
// --- Sessions list and session detail (phase 2, wp/ui-sessions) ---------------------------------
// Wording for `#/sessions` and `#/sessions/:id`. Add-only: other screens add their own sections.

/** What an untitled session is called. Never left blank. */
export const UNTITLED_SESSION = 'Untitled session';

/** "Helper agent: Explore", or "Helper agent" when Claude Code did not report a type. */
export function helperAgentLabel(agentType: string | null): string {
  return agentType ? `${GLOSSARY.helperAgent.term}: ${agentType}` : GLOSSARY.helperAgent.term;
}

export const SESSIONS_COPY = {
  filters: {
    label: 'Session filters',
    project: 'Project',
    allProjects: 'All projects',
    status: 'Status',
    anyStatus: 'Any status',
    model: 'Model',
    anyModel: 'Any model',
    provider: 'Provider',
    anyProvider: 'Any provider',
    search: 'Find a session',
    searchPlaceholder: 'Find a session by id',
    searchTip:
      "Matches session ids (the short code under each name), or part of one. Searching by name isn't available yet.",
    clear: 'Clear filters',
    find: 'Find',
  },
  table: {
    label: 'Sessions',
    session: 'Session',
    project: 'Project',
    status: 'Status',
    helpers: 'Helper agents',
    /** helperAgentsText (Overview section) returns null for 0; the list says it in words. */
    noHelpers: 'No helper agents',
    tokens: GLOSSARY.tokensThisSession.term,
    lastActivity: 'Last activity',
    noProject: 'Not in a project',
    noActivity: 'No activity yet',
    loading: 'Loading sessions…',
    addProject: 'Add a project',
  },
  pager: {
    label: 'Pages',
    previous: 'Previous page',
    next: 'Next page',
    page: (n: number) => `Page ${formatCount(n)}`,
    updating: 'Updating…',
  },
  relate: {
    title: 'How sessions relate',
    description:
      'Which sessions started helper agents or were continued in another session, and which ran at the same time.',
    tabs: { relationships: 'Relationships', timeline: 'Timeline' },
    pick: 'Show relationships for',
    pickHint: 'Pick a session to see the helper agents it started and where it was continued.',
    legend: {
      subagent: 'Started a helper agent',
      continuation: 'Continued as',
      noParent: GLOSSARY.noKnownParent.term,
    },
    evidenceNote: "Lines are drawn only where Claude Code's own records show the link.",
    fromRoot: 'Shown from the first session in this family. The one you picked is outlined.',
    size: (n: number) => countOf(n, 'session', 'sessions'),
    dangling: (n: number) =>
      `${countOf(n, 'link points', 'links point')} at a session that wasn't sent, so ${n === 1 ? 'it is' : 'they are'} not drawn.`,
    hideLinked: (n: number) => `Hide ${countOf(n, 'linked session', 'linked sessions')}`,
    showHidden: (n: number) => `Show ${countOf(n, 'hidden session', 'hidden sessions')}`,
    withHelpers: 'With helpers',
    lastActivity: 'Last activity',
    legendLabel: 'Legend',
    loading: 'Loading relationships…',
  },
  family: {
    label: 'Session family',
    title: 'Session family',
    description:
      'Which session started which. Helper agents sit under the session that started them; a dashed line shows where a session was continued.',
    thisSession: 'This session',
    selected: 'Selected',
    showAs: 'Show as',
    tree: 'Tree',
    diagram: 'Diagram',
  },
  timeline: {
    description:
      'Each bar runs from when a session was first seen to its last activity. Bars that overlap ran at the same time.',
    peak: (n: number) =>
      n <= 1
        ? 'No two sessions on this page ran at the same time.'
        : `At most ${formatCount(n)} sessions on this page ran at the same time.`,
    noActivity: 'No activity yet (shown as a dot)',
    empty: 'No sessions on this page.',
    label: 'Session timeline',
  },
} as const;

export const SESSION_DETAIL_COPY = {
  back: 'All sessions',
  loading: 'Loading session…',
  status: 'Status',
  project: 'Project',
  id: 'Id',
  started: 'Started',
  lastActivity: 'Last activity',
  models: 'Model',
  noModel: 'No model reported yet',
  noProject: 'Not in a project',
  seeRelations: 'See how it relates',
  tokens: {
    title: 'Tokens',
    description:
      '"With helpers" already includes "this session", so the two are never added together. Token types are shown side by side, never as one total.',
    noHelpers:
      "This session didn't start any helper agents, so this is also its total with helpers.",
  },
  cost: {
    none: {
      title: "Claude Code didn't report a cost for this session",
      text: 'A cost appears here only when Claude Code reports one. This app never calculates prices.',
    },
    reported: 'Reported',
    scope: {
      session: 'Covers this session only.',
      'session-including-subagents': 'Includes the helper agents this session started.',
      unknown: "Claude Code didn't say whether this includes helper agents.",
    },
    runningTotal:
      "Claude Code's latest running total for this session, shown as reported and never added to other costs.",
    byModel: 'Tokens by model (from the same report)',
    model: 'Model',
    noModels: 'The report lists no tokens by model.',
  },
  related: {
    title: 'Related sessions',
    startedBy: 'Started by',
    continuedFrom: 'Continued from',
    continuedAs: 'Continued as',
    notContinued: "Not continued in another session that we've seen.",
  },
  activity: {
    title: 'Activity',
    description: 'What happened in this session, newest first.',
    loadOlder: 'Load older',
    loading: 'Loading…',
    start: 'That is everything recorded for this session.',
    readAt: 'time not recorded, read',
    rawTable: 'Raw events',
    rawSummary: 'Technical details: raw events',
    raw: {
      occurred: 'Occurred',
      event: 'Event',
      eventId: 'Event id',
      channel: 'Channel',
      provenance: 'Provenance',
      version: 'Claude Code version',
      fields: 'Fields',
    },
  },
  technical: {
    launchFolder: 'Launch folder',
    gitBranch: 'Git branch',
    entryPoint: 'Entry point',
    version: 'Claude Code version',
    provider: 'Provider',
    sessionId: 'Session id',
    providerSessionId: 'Claude Code session id',
    agentId: 'Helper agent id',
    notHelper: 'Not a helper agent',
    origin: 'Origin',
    projectId: 'Project id',
    task: 'Helper agent task',
    firstSeen: 'First seen',
    ended: 'Ended',
    notEnded: 'No end reported',
    attention: 'Last waited for you',
    never: 'Never',
    status: 'Status',
    statusBasis: (evaluatedAt: string) => `derived, evaluated ${evaluatedAt}`,
    parent: 'Parent link',
    parentEvidence: (kind: string, provenance: string, evidence: string) =>
      `${kind} link, ${provenance}, evidence: ${evidence}`,
    noParent: 'none known (no evidence)',
    snapshot: 'Cost report',
    noSnapshot: 'none',
    snapshotSummary: (provenance: string, scope: string) => `${provenance} · scope: ${scope}`,
    sharedRecords: 'Shared usage records',
    sources: 'Where these values come from',
    sourcesText:
      'Observed values were read from Claude Code files or hooks. Status and token totals are derived from them. Cost is estimated: reported by Claude Code, not calculated here.',
  },
} as const;
