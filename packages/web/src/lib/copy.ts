import type {
  AgentRunStatus,
  RunStatus,
  SessionStatus,
  AllowRule,
  ApprovalMode,
  ChangeDecider,
  ChangeDecision,
  ChangeReviewerKind,
  ChangeReviewerMode,
  ChangeState,
  ChangeVerdict,
  TicketBranchState,
} from '@acp/core';
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
    inProject: 'Every Claude Code session in this project, and how they relate to each other.',
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
  // Redesign (R-A): Setup moved under Data health as its "Connection" section.
  setup: {
    title: 'Connection',
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
    textInProject: 'Sessions appear here once Claude Code runs inside this project.',
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
  // Every count names its own unit (owner: no abbreviations such as "30 input").
  return `Used ${part(input, 'input tokens')} · ${part(output, 'output tokens')}`;
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

// --- Shared counting words (phase 2, wp/ui-tokens; its pages were replaced by the redesign) -----

/** "1 session" / "12 sessions": a count with its noun, so a number never stands alone. */
export function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : plural}`;
}

export type DatePreset = '7d' | '30d' | 'all' | 'custom';

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

// --- Control panel (Phase 3 M1, wp/p3-e-control-ui) ---------------------------------------------

/** A run or agent status as a word, a one-line tip, and how it looks (`tone`). */
export interface ControlStatusCopy {
  word: string;
  tip: string;
  /** `passed` is a check that succeeded (a green dot); `done` is work that ended (grey). */
  tone: 'working' | 'waiting' | 'done' | 'passed' | 'stopped' | 'problem';
}

/**
 * Run states (orchestration-lifecycle §0) in words. Only a run whose changes were all merged or
 * discarded reads "Finished"; there is still no "completed" for sessions.
 */
export const RUN_STATUS_COPY: Readonly<Record<RunStatus, ControlStatusCopy>> = {
  QUEUED: { word: 'Starting', tip: 'The run is getting ready.', tone: 'working' },
  PLANNING: {
    word: 'Planning',
    tip: 'The lead agent is reading the code and writing a plan for you to approve.',
    tone: 'working',
  },
  PLAN_REVIEW: {
    // The board's stage word (R-H): one word for plan review everywhere.
    word: 'Plan review',
    tip: 'A plan is ready for you. Read it, then approve it or say what should change. No helper starts before that.',
    tone: 'waiting',
  },
  RUNNING: { word: 'Running', tip: 'Agents are working.', tone: 'working' },
  BLOCKED: {
    word: 'Waiting for you',
    tip: 'An agent is paused until you answer a request.',
    tone: 'waiting',
  },
  REVIEW: {
    word: 'Ready for your review',
    tip: 'Every agent has stopped. Merge or discard their changes below.',
    tone: 'waiting',
  },
  COMPLETED: {
    word: 'Finished — all changes reviewed',
    tip: "You merged or discarded every helper agent's changes.",
    tone: 'done',
  },
  FAILED: { word: 'Failed', tip: 'The run stopped because of an error.', tone: 'problem' },
  CANCELLING: { word: 'Stopping', tip: 'The agents are being stopped.', tone: 'stopped' },
  CANCELLED: { word: 'Stopped', tip: 'This run was stopped.', tone: 'stopped' },
  NEEDS_REVIEW: {
    word: 'Interrupted — check its work',
    tip: 'The app restarted while agents were working. Their work was not restarted; review what they left.',
    tone: 'problem',
  },
};

export const AGENT_STATUS_COPY: Readonly<Record<AgentRunStatus, ControlStatusCopy>> = {
  QUEUED: { word: 'Waiting to start', tip: 'It starts shortly.', tone: 'working' },
  STARTING: { word: 'Starting', tip: 'Claude is starting up.', tone: 'working' },
  RUNNING: { word: 'Working', tip: 'It is working on its task.', tone: 'working' },
  WAITING_APPROVAL: {
    word: 'Waiting for your approval',
    tip: 'It asked to change something and waits for your answer.',
    tone: 'waiting',
  },
  BLOCKED: {
    word: 'Paused at its budget',
    tip: 'It used up its budget and waits for you to let it continue or stop it.',
    tone: 'waiting',
  },
  // ADR-0021: a helper or tester whose change is in the review loop. No process runs.
  AWAITING_REVIEW: {
    word: 'Waiting for review',
    tip: 'It finished its part. Its change is reviewed, then the lead merges it into the ticket branch, sends it back for rework or discards it.',
    tone: 'waiting',
  },
  SUCCEEDED: { word: 'Finished its task', tip: 'It reported that it is done.', tone: 'done' },
  FAILED: { word: 'Failed', tip: 'It stopped because of an error.', tone: 'problem' },
  CANCELLED: { word: 'Stopped', tip: 'It was stopped.', tone: 'stopped' },
  TIMED_OUT: { word: 'Timed out', tip: 'It ran out of time and was stopped.', tone: 'problem' },
  NEEDS_REVIEW: {
    word: 'Interrupted — check its work',
    tip: 'The app restarted while it was working. It was not restarted.',
    tone: 'problem',
  },
};

/**
 * A `CANCELLED` agent the engine closed after its part went well (`closedByEngine`): the lead
 * when the reviewer or tester starts, or any open agent when the run completes.
 */
export const AGENT_FINISHED_COPY: ControlStatusCopy = {
  word: 'Finished',
  tip: 'Its part is done. The app closed it when the next step started.',
  tone: 'done',
};

export const CONTROL_COPY = {
  nav: 'Control panel',
  page: {
    title: 'Control panel',
    description:
      'Chat with a lead agent that starts helper agents for you. Nothing in your project changes without your approval.',
  },
  allRuns: 'All runs',
  newRun: 'New run',
  loading: 'Loading the run…',
  terms: {
    lead: {
      term: 'Lead agent',
      tip: 'The agent you chat with. It reads your project, plans the work and starts helper agents. It never edits files itself.',
    },
    worker: {
      term: 'Helper agent',
      tip: 'An agent the lead agent started for one task. It works in its own copy of your project, so your files stay untouched until you merge its changes.',
    },
    budget: {
      term: 'Budget tokens',
      tip: 'Budget tokens count what an agent adds: output tokens, input tokens and cache write tokens. Cache read tokens are not counted, because every turn re-reads the whole conversation and they would use up any budget at once. The limit is soft: work already under way can go a little over, then the agent pauses and asks you whether to continue.',
    },
  },
  start: {
    title: 'Start a run',
    description: 'Pick a project and tell the lead agent what you want done.',
    project: 'Project',
    projectHint: 'Agents only work inside a project you added.',
    chooseProject: 'Choose a project',
    noProjects: {
      title: 'Add a project first',
      text: 'Agents can only work in a folder you added as a project.',
      action: 'Go to Setup',
    },
    task: 'What should the agents do?',
    taskHint: 'Optional. You can keep chatting with the lead agent after the run starts.',
    taskPlaceholder:
      'For example: spin up two agents. One adds a settings page, the other writes tests for it.',
    budget: 'Budget per agent',
    budgetHint: 'In budget tokens. An agent that reaches it pauses and asks you.',
    budgetInvalid: 'Enter a whole number of budget tokens above 0.',
    submit: 'Start run',
    starting: 'Starting…',
    projectMissing: 'Choose a project.',
    failed: "The run didn't start.",
    sentFailed: "The run started, but your first message wasn't sent. Send it again below.",
  },
  runs: {
    title: 'Your runs',
    description: 'Earlier and ongoing runs, newest first.',
    empty: {
      title: 'No runs yet',
      text: 'Start a run and it will be listed here.',
    },
    loading: 'Loading runs…',
  },
  chat: {
    title: 'Chat with the lead agent',
    you: 'You',
    lead: 'Lead agent',
    empty: {
      title: 'Nothing said yet',
      text: 'Tell the lead agent what you want done. It plans the work and starts helper agents.',
    },
    label: 'Message to the lead agent',
    placeholder: 'Message the lead agent…',
    hint: 'Enter sends, Shift+Enter adds a line.',
    send: 'Send',
    sending: 'Sending…',
    closed: 'This run has ended, so the chat is closed.',
    failed: "Your message wasn't sent.",
    tooLong: (max: number) => `Keep it under ${formatCount(max)} characters.`,
    /** Prefilled when the owner clicks Message on a helper agent's card. */
    messageFor: (role: string) => `Please tell the ${role}: `,
    relayNote: 'The lead agent passes your message on to its helper agents.',
    /** The same box for the agent it reaches, e.g. "planner agent" (ticket page side panel). */
    withAgent: (who: string) => ({
      title: `Chat with the ${who}`,
      label: `Message to the ${who}`,
      placeholder: `Message the ${who}…`,
      empty: { text: `Tell the ${who} what you want done.` },
    }),
  },
  agents: {
    title: 'Agents',
    description: 'The lead agent at the top, the helper agents it started beneath it.',
    none: 'No helper agents yet. The lead agent starts them when it needs them.',
    noAgents: 'No agents yet. The lead agent appears here once the run starts.',
    showAll: 'Show all',
    showLess: 'Show less',
    startedBy: (role: string) => `Started by ${role}`,
    latest: 'Latest',
    noActivity: 'Nothing yet',
    task: 'Task',
    budgetText: (used: string, limit: string) => `${used} of ${limit} budget tokens`,
    overBy: (n: string) => `${n} budget tokens over its budget`,
    costNoSession: 'Claude Code has not reported a cost for this agent yet.',
    message: 'Message',
    stop: 'Stop',
    openSession: 'Open its session',
    helpers: 'Helper agents it started inside Claude Code',
    confirmStop: (role: string) =>
      `Stop the ${role}? It stops right away. Changes it already made stay for you to review.`,
    confirmStopLead: 'Stop the lead agent? It stops right away and starts no more helper agents.',
    stopConfirm: 'Stop agent',
    keep: 'Keep running',
    stopping: 'Stopping…',
    stopFailed: "The agent didn't stop.",
  },
  approvals: {
    title: 'Waiting for your approval',
    description:
      'Agents ask before they change files or run commands. Nothing happens until you answer.',
    timeout: (minutes: number) =>
      `A request nobody answers is denied automatically after ${minutes} minutes.`,
    toolUse: (role: string) => `The ${role} wants to:`,
    budgetRaise: (role: string) =>
      `The ${role} used up its budget. Approve to let it continue, or deny to stop it.`,
    budgetRaiseShort: 'Asked to continue past its budget',
    approve: 'Approve',
    deny: 'Deny',
    failed: "Your answer wasn't saved.",
    history: (n: number) => `Earlier requests (${formatCount(n)})`,
    status: {
      pending: 'Waiting',
      approved: 'Approved',
      denied: 'Denied',
      expired: 'Denied automatically (no answer in time)',
    },
  },
  review: {
    title: 'Review changes',
    description:
      'Each helper agent worked in its own copy of your project. Merge its changes into your project, or discard them.',
    loading: 'Loading changes…',
    into: (base: string) => `To merge into ${base}`,
    files: (n: number) => `${formatCount(n)} changed ${n === 1 ? 'file' : 'files'}`,
    noFiles: 'No files changed.',
    added: (n: number) => `${formatCount(n)} ${n === 1 ? 'line' : 'lines'} added`,
    removed: (n: number) => `${formatCount(n)} ${n === 1 ? 'line' : 'lines'} removed`,
    linesNotReported: 'Line counts not reported',
    fileStatus: {
      added: 'New',
      modified: 'Changed',
      deleted: 'Deleted',
      renamed: 'Renamed',
    },
    diff: 'The changes, line by line',
    merge: 'Merge',
    discard: 'Discard',
    confirmMerge: (role: string, base: string) =>
      `Merge the ${role}'s changes into ${base}? This changes the files in your project.`,
    confirmDiscard: (role: string) =>
      `Discard the ${role}'s changes? Its copy of the project is deleted. This can't be undone.`,
    confirmMergeButton: 'Merge changes',
    confirmDiscardButton: 'Discard changes',
    cancel: 'Cancel',
    working: 'Working…',
    failed: "That didn't work.",
    waitForStop: 'You can merge or discard once this agent has stopped.',
    state: {
      pending: 'Waiting for your review',
      merged: 'Merged into your project',
      discarded: 'Discarded',
      'no-changes': 'No changes to review',
    },
    branch: 'Branch',
    baseBranch: 'Merges into',
  },
  stopAll: {
    button: 'Stop all',
    confirm:
      'Stop the lead agent and every helper agent? They stop right away. Changes already made stay for you to review.',
    confirmButton: 'Stop everything',
    keep: 'Keep running',
    stopping: 'Stopping…',
    failed: "The run didn't stop.",
  },
  facts: {
    status: 'Status',
    project: 'Project',
    projectMissing: 'No longer in your projects',
    started: 'Started',
    updated: 'Last change',
    budget: 'Budget per agent',
    agents: (n: number) => `${formatCount(n)} ${n === 1 ? 'agent' : 'agents'}`,
    approvals: (n: number) =>
      `${formatCount(n)} ${n === 1 ? 'request waits' : 'requests wait'} for your approval`,
  },
  technical: {
    summary: 'Technical details',
    runId: 'Run id',
    agentId: 'Agent id',
    sessionId: 'Session id',
    noSession: 'Not linked to a session yet',
    costWarning: 'Cost warning at (estimated)',
    noCostWarning: 'None',
    ended: 'Ended',
    notEnded: 'Not ended',
  },
  notFound: {
    title: 'Run not found',
    text: 'There is no run at this address. It may have been deleted.',
  },
} as const;

// --- Board (Phase 4, wp/p4-e-board) -------------------------------------------------------------

// Kept inside this section (imports are hoisted) so parallel WPs only ever append to copy.ts.
import type { HarnessState, TicketPriority, TicketStage, TicketType } from '@acp/core';

/** A board column: its name, a one-line tip, and what an empty column says. */
export interface StageCopy {
  word: string;
  tip: string;
  empty: string;
}

/** Board columns (docs/history/phase-4/README.md §5.2), in board order. */
export const STAGE_COPY: Readonly<Record<TicketStage, StageCopy>> = {
  BACKLOG: {
    word: 'Backlog',
    tip: "Tickets you wrote but haven't marked ready yet. New tickets land here.",
    empty: 'New tickets land here.',
  },
  READY: {
    word: 'Ready',
    tip: 'Ready for the agents. Start a ticket and the lead agent plans it first.',
    empty: 'Move a ticket here when it is ready to work on.',
  },
  PLANNING: {
    word: 'Planning',
    tip: 'The lead agent is reading the code and writing a plan. Nothing changes yet.',
    empty: 'Drop a ready ticket here to start it.',
  },
  PLAN_REVIEW: {
    word: 'Plan review',
    tip: 'A plan waits for you. Approve it or say what should change; no helper starts before that.',
    empty: 'No plan is waiting for you.',
  },
  WORKING: {
    word: 'Agents working',
    tip: 'Helper agents are making the changes, each in its own copy of the project.',
    empty: 'No agents are working.',
  },
  NEEDS_YOU: {
    word: 'Needs you',
    tip: 'An agent waits for your answer: an action that is not pre-approved, or more budget.',
    empty: 'Nothing waits for you.',
  },
  IN_REVIEW: {
    word: 'In review',
    tip: 'The agents stopped. Review their changes and checks, then merge or discard each one.',
    empty: 'Nothing to review.',
  },
  DONE: {
    word: 'Done',
    tip: 'Every change was merged or discarded. The ticket keeps its history.',
    empty: 'Finished tickets appear here.',
  },
  CANCELLED: {
    word: 'Cancelled',
    tip: 'Tickets you cancelled. They are kept with their history, never deleted.',
    empty: 'No cancelled tickets.',
  },
};

export const TICKET_TYPE_COPY: Readonly<Record<TicketType, { word: string; tip: string }>> = {
  feature: { word: 'Feature', tip: 'Something new for the project.' },
  bug: { word: 'Bug', tip: 'Something that is broken.' },
  chore: { word: 'Chore', tip: 'Upkeep: clean-up, upgrades, small tasks.' },
  harness: {
    word: 'Harness',
    tip: 'Work on the checks that let agents verify their own changes.',
  },
};

export const TICKET_PRIORITY_COPY: Readonly<Record<TicketPriority, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export interface HarnessStateCopy {
  word: string;
  tip: string;
  tone: 'ok' | 'partial' | 'problem' | 'none';
}

export const HARNESS_STATE_COPY: Readonly<Record<HarnessState, HarnessStateCopy>> = {
  ready: {
    word: 'Ready',
    tip: "The project's checks are set up, with at least one that must pass before merge.",
    tone: 'ok',
  },
  partial: {
    word: 'Partial',
    tip: 'Checks are set up, but none is required, so nothing has to pass before merge.',
    tone: 'partial',
  },
  invalid: {
    word: 'Invalid',
    tip: "The checks file (.acp/harness.json) can't be read. Open the project setup to see why.",
    tone: 'problem',
  },
  none: {
    word: 'None',
    tip: 'This project has no checks for agents yet. A "Build the harness" ticket can add them.',
    tone: 'none',
  },
};

export const BOARD_COPY = {
  nav: 'Board',
  page: {
    title: 'Board',
    description: 'Your tickets, from idea to merged change.',
    tip: 'An agent plans each ticket; you approve the plan, then review and merge the changes. Each card shows its latest run’s estimated cost; costs are never added up.',
  },
  loading: 'Loading the board…',
  newTicket: 'New ticket',
  links: { tokens: 'Tokens', harness: 'Harness' },
  stats: {
    running: (n: number) => `${formatCount(n)} running`,
    needsYou: (n: number) => `${formatCount(n)} ${n === 1 ? 'needs' : 'need'} you`,
  },
  card: {
    helpers: (n: number) => `${formatCount(n)} ${n === 1 ? 'helper' : 'helpers'}`,
    needsYou: (n: number) => `${formatCount(n)} ${n === 1 ? 'needs' : 'need'} you`,
    lastRun: { failed: 'Last run failed', stopped: 'Last run stopped' },
    priority: (word: string) => `${word} priority`,
  },
  column: {
    count: (n: number) => `${formatCount(n)} ${n === 1 ? 'ticket' : 'tickets'}`,
    /** A folded column (Cancelled, or an empty one): its button's name. */
    show: (word: string, n: number) => `Show ${word.toLowerCase()} (${formatCount(n)})`,
    hide: 'Hide',
    hideLabel: (word: string) => `Hide ${word.toLowerCase()}`,
    scrollBack: 'Scroll to earlier columns',
    scrollOn: 'Scroll to later columns',
    /** Tickets in the columns out of view to the right. */
    moreTickets: (n: number) => `${formatCount(n)} more ${n === 1 ? 'ticket' : 'tickets'}`,
  },
  move: {
    button: 'Move',
    menuLabel: (key: string) => `Move ${key}`,
    toBacklog: 'Move to Backlog',
    toReady: 'Move to Ready',
    start: 'Start (the lead agent plans it)',
    cancel: 'Cancel ticket…',
    none: 'The agents move this ticket now. Open it to act on it.',
    moved: (key: string, to: string) => `Moved ${key} to ${to}.`,
    started: (key: string) => `Started ${key}. The lead agent is planning it.`,
    cancelled: (key: string) => `Cancelled ${key}.`,
    failed: (key: string) => `${key} didn't move.`,
    startFailed: (key: string) => `${key} didn't start.`,
  },
  cancel: {
    title: (key: string) => `Cancel ${key}?`,
    text: 'The ticket moves to Cancelled. If agents are working on it, they are stopped. It keeps its history and can be re-run later.',
    confirm: 'Cancel ticket',
    keep: 'Keep it',
    working: 'Cancelling…',
  },
  dialog: {
    title: 'New ticket',
    description:
      'Describe the work. The ticket lands in Backlog; move it to Ready when it is ready.',
    titleField: 'Title',
    titlePlaceholder: 'For example: Add a dark mode toggle',
    titleMissing: 'Give the ticket a title.',
    titleTooLong: 'Keep the title to 200 characters or fewer.',
    type: 'Type',
    priority: 'Priority',
    labels: 'Labels',
    labelsHint: 'Optional. Separate labels with commas: up to 10, each up to 30 characters.',
    labelsTooMany: 'Use at most 10 labels.',
    labelTooLong: 'Each label can be at most 30 characters.',
    descriptionField: 'Description',
    descriptionHint:
      'Optional. What should change and why. The lead agent reads this when it plans the ticket.',
    create: 'Create ticket',
    creating: 'Creating…',
    cancel: 'Cancel',
    failed: "The ticket wasn't created.",
    created: (key: string) => `Created ${key} in Backlog.`,
  },
  empty: {
    noTickets: {
      title: 'No tickets yet',
      text: 'Write a first ticket. An agent plans it with you before anything changes.',
    },
    notFound: {
      title: 'Project not found',
      text: 'There is no project at this address. It may have been removed.',
      action: 'All projects',
    },
  },
} as const;

// --- New project wizard and project settings (Phase 4, wp/p4-f-project-setup) ------------------
import type { CheckRunStatus } from '@acp/core';

/**
 * Harness states (docs/history/phase-4/README.md §3) as a word, a one-line explanation and a tone.
 */
export const SETUP_HARNESS_STATE_COPY: Readonly<Record<HarnessState, ControlStatusCopy>> = {
  ready: {
    word: 'Ready',
    tip: 'The project has a harness with at least one required check. Agents can verify their own changes, and a failed required check stops a plain merge.',
    tone: 'done',
  },
  partial: {
    word: 'Partial',
    tip: 'The project has a harness, but none of its checks is required, so nothing has to pass before a merge. Mark at least one check as required.',
    tone: 'waiting',
  },
  invalid: {
    word: 'Invalid',
    tip: "The project has a harness file (.acp/harness.json), but it can't be read. Fix the problems below; until then no checks run.",
    tone: 'problem',
  },
  none: {
    word: 'None',
    tip: "The project has no harness yet, so agents can't check their own work and nothing is checked before a merge. Let an agent build one with the ticket below.",
    tone: 'stopped',
  },
};

/** Check run results (ADR-0017) in words. */
export const CHECK_STATUS_COPY: Readonly<Record<CheckRunStatus, ControlStatusCopy>> = {
  passed: { word: 'Passed', tip: 'The command finished without an error.', tone: 'passed' },
  failed: { word: 'Failed', tip: 'The command finished with an error.', tone: 'problem' },
  'timed-out': {
    word: 'Took too long',
    tip: 'The command ran past its time limit and was stopped.',
    tone: 'problem',
  },
  error: {
    word: "Couldn't run",
    tip: "The command couldn't be started, for example because it isn't installed.",
    tone: 'problem',
  },
  skipped: { word: 'Skipped', tip: 'This check was not run.', tone: 'stopped' },
  interrupted: {
    word: 'Stopped',
    tip: 'The app stopped before this check finished, so it has no result. The checks run again before a merge.',
    tone: 'stopped',
  },
};

/** "12.4 KB": file sizes in the context picker (1 KB = 1,024 bytes, like the 32 KB limit). */
export function formatKiB(bytes: number): string {
  if (bytes < 1024) return `${formatCount(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const kib = bytes / 1024;
  return `${kib < 10 ? kib.toFixed(1) : formatCount(Math.round(kib))} KB`;
}

export const PROJECT_SETUP_COPY = {
  wizard: {
    title: 'New project',
    description:
      'Add a project and decide how AI agents work on it. You can change all of this later in its settings.',
    back: 'Back',
    next: 'Next',
    finish: 'Finish and open the board',
    saving: 'Saving…',
    progressLabel: 'Setup steps',
    stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
    steps: {
      source: 'Project',
      agents: 'How agents work',
      allowlist: 'Pre-approved actions',
      context: 'Context files',
      harness: 'Harness',
    },
    toProjects: 'Projects',
    saveFailed: "Your choices couldn't be saved.",
  },
  source: {
    title: 'Where is the project?',
    description:
      'Use a git repository you already have, or let this app create a new, empty one for you.',
    choiceLabel: 'Project source',
    existing: 'Add an existing folder',
    existingHint: 'A git repository that is already on this computer.',
    newRepo: 'Create a new repository',
    newRepoHint: 'A new folder with git set up and a first commit on the main branch.',
    parentLabel: 'Create it inside',
    parentHint: 'A folder that already exists. Use the full path, starting with /.',
    parentPlaceholder: '/Users/me/code',
    nameLabel: 'Repository name',
    nameHint: 'Becomes the new folder’s name. Letters, digits, dots, dashes and underscores.',
    namePlaceholder: 'my-new-app',
    willCreate: 'New folder',
    readmeLabel: 'First README (optional)',
    readmeHint: 'Saved as README.md in the first commit. You can leave it empty.',
    readmePlaceholder: '# My new app\n\nWhat this project is for.',
    create: 'Create repository',
    adding: 'Adding…',
    creating: 'Creating…',
    added: (name: string) => `${name} is added.`,
    addedText: 'Next, choose how agents work on it.',
    createdText:
      'A new git repository with a first commit on main. Next, choose how agents work on it.',
    alreadyAdded:
      'This project is already added. Settings you choose next apply to it; to add a different one, start the wizard again.',
    errors: {
      parentMissing: 'Enter the folder to create the repository in.',
      parentNotAbsolute: 'Use the full folder path, starting with / (for example /Users/me/code).',
      nameMissing: 'Give the repository a name.',
      nameInvalid:
        'Use only letters, digits, dots, dashes and underscores, starting with a letter or digit (at most 100 characters).',
      readmeTooLong: 'Keep the README under 20,000 characters.',
      exists: 'A folder with that name already exists there. Pick another name.',
      parentNotFound:
        "That folder wasn't found on this computer, or it isn't a folder. Check the path and try again.",
      generic: "The repository couldn't be created.",
    },
  },
  agents: {
    title: 'How agents work',
    description:
      'A lead agent plans each ticket and hands parts of it to helper agents. These are the limits it works within.',
    planFirst: 'Plan first',
    planFirstValue: 'On',
    planFirstHint:
      'The lead agent always proposes a plan, and no helper starts until you approve it. This is always on for now.',
    projectKey: 'Ticket prefix',
    projectKeyHint: 'Starts every ticket number on this project’s board, for example WEB-12.',
    helpers: 'Helpers at once',
    helpersHint: (max: number) =>
      `How many helper agents may work at the same time (1 to ${max}). More helpers finish sooner but use more tokens.`,
    helpersValue: (n: number) => countOf(n, 'helper'),
    depth: 'Helper depth',
    depthOptions: {
      1: {
        label: 'Only the lead starts helpers',
        hint: 'Simplest to follow. Recommended.',
      },
      2: {
        label: 'Helpers may start their own helpers',
        hint: 'One more level, for large tickets. Still within the helpers-at-once limit.',
      },
    },
    budget: 'Budget per agent',
    budgetHint:
      'Each agent stops when it has used this many budget tokens (output plus new input; cache reads are not counted).',
    budgetValue: (n: number) => `${formatCount(n)} budget tokens`,
    model: 'Model',
    modelHint: 'Leave empty to use Claude Code’s default model, or enter a model name.',
    modelPlaceholder: 'Claude Code’s default',
    errors: {
      projectKey: 'Use 2 to 6 capital letters for the ticket prefix, for example WEB.',
      budget: 'Enter the budget as a whole number above zero, for example 500,000.',
      modelTooLong: 'Use a shorter model name (at most 100 characters).',
    },
  },
  allowlist: {
    title: 'Pre-approved actions',
    description:
      'Agents ask you before they change files or run commands. You can let them do these two safe things without asking. Everything else still asks.',
    edit: 'Let helpers edit files in their own copy without asking',
    editHint:
      'Each helper works in its own copy of the project (a git worktree). Edits there never touch your files until you merge them.',
    checks: 'Let helpers run this project’s checks without asking',
    checksHint: 'Only the exact check commands listed in the harness. Other commands still ask.',
    checksNoHarness: 'This takes effect once the project has a harness.',
    recorded: 'Every pre-approved action is still recorded with the run, so you can see it later.',
  },
  context: {
    title: 'Context for agents',
    description:
      'Files every agent reads before it starts, such as CLAUDE.md with your project’s rules.',
    limits: (max: number, maxKiB: number) => `At most ${max} files and ${maxKiB} KB in total.`,
    selected: (n: number, max: number) => `${formatCount(n)} of ${max} files chosen`,
    size: (used: string, maxKiB: number) => `${used} of ${maxKiB} KB`,
    suggested: 'Suggested',
    loading: 'Looking for files…',
    none: 'No suitable files were found in this project.',
    notListed: 'Not found in the project any more',
    sizeUnknown: 'Size not reported',
    listLabel: 'Context files',
    errors: {
      tooMany: (max: number) => `Choose at most ${max} files.`,
      tooLarge: (maxKiB: number) =>
        `The chosen files are larger than ${maxKiB} KB together. Leave some out.`,
    },
  },
  harness: {
    title: 'Harness',
    description:
      'The project’s own checks (tests, lint, build) that let agents verify their work. They are listed in .acp/harness.json in the repository.',
    status: 'Status',
    problems: 'What needs fixing',
    checks: 'Checks',
    noChecks: 'No checks listed.',
    required: 'Required',
    optional: 'Optional',
    requiredTip: 'Must pass before a plain merge.',
    checkedAt: 'Read from the repository',
    createTicket: 'Create a ‘Build the harness’ ticket',
    creatingTicket: 'Creating…',
    ticketCreated: (key: string) => `Added ${key} “Build the harness” to the board.`,
    ticketCreatedText: 'Start it from the board. You approve its plan and review its changes.',
    openTicket: 'Open ticket',
    ticketFailed: "The ticket couldn't be created.",
    ticketExplain:
      'A ready-written ticket asks an agent to add fast checks and write .acp/harness.json. You approve its plan and review its changes like any other ticket.',
    commandNote: 'Checks come from .acp/harness.json in the repository.',
    timeLimit: (sec: number) => `time limit ${sec} s`,
    inFolder: (cwd: string) => `in ${cwd}`,
  },
  settings: {
    title: 'Settings',
    description: 'The project, its board key and what every agent reads first.',
    tip: 'Changes apply to runs started from now on. Running agents keep their settings.',
    formLabel: 'Project settings',
    project: {
      title: 'Project',
      description: 'Where the project lives, and how its tickets are numbered.',
      name: 'Name',
      folder: 'Folder',
      boardKey: 'Board key',
      boardKeyHint: 'Starts every ticket number on this project’s board, for example WEB-12.',
      model: 'Default model',
      modelHint:
        'Used by every agent whose workflow stage names no model. Leave empty for Claude Code’s default.',
    },
    elsewhere: {
      title: 'Agents and checks',
      workflow:
        'Agent limits, the budget per agent and pre-approved actions are set on the Workflow page.',
      workflowLink: 'Open Workflow',
      harness: 'The checks for the agents’ work, and their results, are on the Harness page.',
      harnessLink: 'Open Harness',
    },
    save: 'Save changes',
    saving: 'Saving…',
    saved: 'Saved.',
    unsaved: 'You have unsaved changes.',
    reset: 'Undo changes',
    saveFailed: "Your changes couldn't be saved.",
    danger: 'Danger zone',
    dangerText:
      'Removing a project from this app isn’t available yet. When it is, it will never delete the folder or its git history, and it won’t be possible while the project has tickets or runs.',
  },
} as const;

// --- Ticket page (Phase 4, wp/p4-g-ticket) ------------------------------------------------------
//
// Kept inside this section (imports are hoisted). `TicketStage` and `CheckRunStatus` are imported
// by the board and project-setup sections above; check results use `CHECK_STATUS_COPY` from there.
import type { TicketPlanStatus } from '@acp/core';

/**
 * A ticket's board stage (README §6.2) with a tone for the status pill. The word is the board
 * column's, so a ticket reads the same on the board and on its page. Never "completed".
 */
export const TICKET_STAGE_COPY: Readonly<Record<TicketStage, ControlStatusCopy>> = {
  BACKLOG: {
    word: STAGE_COPY.BACKLOG.word,
    tip: 'Not planned yet. Move it to Ready on the board when it should be worked on.',
    tone: 'stopped',
  },
  READY: {
    word: STAGE_COPY.READY.word,
    tip: 'Ready to start. Start lets the agents work on it.',
    tone: 'waiting',
  },
  PLANNING: {
    word: STAGE_COPY.PLANNING.word,
    tip: 'An agent is reading the code and writing a plan for you to approve.',
    tone: 'working',
  },
  PLAN_REVIEW: {
    word: STAGE_COPY.PLAN_REVIEW.word,
    tip: 'A plan is ready for you. Approve it or say what should change. No helper starts before that.',
    tone: 'waiting',
  },
  WORKING: {
    word: STAGE_COPY.WORKING.word,
    tip: 'Helper agents are working on the plan.',
    tone: 'working',
  },
  NEEDS_YOU: {
    word: STAGE_COPY.NEEDS_YOU.word,
    tip: 'An agent asked for something and waits for your answer.',
    tone: 'waiting',
  },
  IN_REVIEW: {
    word: STAGE_COPY.IN_REVIEW.word,
    tip: "The agents have stopped. Look at each helper agent's changes and checks, then merge or discard them.",
    tone: 'waiting',
  },
  DONE: { word: STAGE_COPY.DONE.word, tip: 'Every change was merged or discarded.', tone: 'done' },
  CANCELLED: {
    word: STAGE_COPY.CANCELLED.word,
    tip: 'This ticket was cancelled.',
    tone: 'stopped',
  },
};

export const PLAN_STATUS_COPY: Readonly<Record<TicketPlanStatus, string>> = {
  proposed: 'Waiting for your decision',
  approved: 'Approved',
  'changes-requested': 'You asked for changes',
  superseded: 'Replaced by a newer version',
};

export const TICKET_COPY = {
  loading: 'Loading the ticket…',
  backToBoard: 'Board',
  openBoard: 'Open board',
  description:
    'The agents working on this ticket, what each one is doing, and what waits for you. Nothing changes in your project until you merge.',
  notFound: {
    title: 'Ticket not found',
    text: 'There is no ticket at this address.',
  },
  type: { feature: 'Feature', bug: 'Bug', chore: 'Chore', harness: 'Harness' },
  priority: {
    low: 'Low priority',
    medium: 'Medium priority',
    high: 'High priority',
    urgent: 'Urgent',
  },
  summary: {
    agents: (n: number) => `${formatCount(n)} ${n === 1 ? 'agent' : 'agents'}`,
    needsYou: (n: number) =>
      `${formatCount(n)} ${n === 1 ? 'request waits' : 'requests wait'} for you`,
    budget: (n: number) => `${formatCount(n)} budget tokens used`,
    noRun: 'No run yet',
  },
  runPicker: {
    label: 'Run',
    option: (n: number, total: number, status: string) => `Run ${n} of ${total} · ${status}`,
    earlier: 'You are looking at an earlier run of this ticket.',
    backToLatest: 'Show the latest run',
  },
  lastRun: {
    FAILED: 'The last run failed. You can start a new one.',
    CANCELLED: 'The last run was stopped. You can start a new one.',
  },
  actions: {
    start: 'Start',
    rerun: 'Re-run',
    starting: 'Starting…',
    startFailed: "The run didn't start.",
    rerunTip: 'Starts a new run on this ticket. Earlier runs stay in its history.',
  },
  roles: {
    lead: {
      term: 'Lead agent',
      tip: 'The main agent of the run. It reads your project but never edits it, and hands parts of the ticket to helper agents.',
    },
    worker: {
      term: 'Helper agent',
      tip: 'An agent started for one part of the ticket. It works in its own copy of your project, so your files stay untouched until you merge its changes.',
    },
    planner: {
      term: 'Planner agent',
      tip: 'A read-only agent that writes the plan and revises it on your comments. The lead starts once you approve it.',
    },
    reviewer: {
      term: 'Reviewer agent',
      tip: 'A read-only agent that reads the merged result and posts its findings as ticket comments. It never blocks a merge.',
    },
    tester: {
      term: 'Tester agent',
      tip: 'An agent that writes unit tests for the merged change in its own copy. You review and merge them like any change.',
    },
  },
  speaker: {
    owner: 'You',
    lead: 'Lead agent',
    planner: 'Planner agent',
    'lead-or-planner': 'Lead or planner',
    leadOrPlannerTip:
      'This message came from the lead agent or the planner; the app can’t tell which one wrote it.',
    chatEnded: 'The agent you chat with has finished its work, so the chat is closed.',
  },
  workflow: {
    title: 'Workflow',
    description: 'Where this run is: each stage of the project’s workflow, live.',
    tip: 'The stages come from the project’s Workflow page. Models and skills on the stages are the project’s current settings. Click a stage to show its agent in the side panel.',
    changedSince:
      'The workflow settings changed after this run started; the models and skills shown are the current ones.',
    graphLabel: 'This run’s workflow stages',
    states: {
      off: 'Off',
      waiting: 'Waiting',
      active: 'Working',
      'needs-you': 'Needs you',
      done: 'Done',
      failed: 'Failed',
      skipped: 'Skipped',
    },
    helperNone: 'No helpers yet',
    helpersWorking: (n: number) => `${formatCount(n)} working`,
    reviewerComments: (n: number) =>
      `${formatCount(n)} ${n === 1 ? 'finding' : 'findings'} from the reviewer in the conversation`,
    held: {
      title: (stage: string) => `${stage} is waiting for you`,
      text: (stage: string) =>
        `The app restarted before ${stage.toLowerCase()} started, so it was not started on its own. Continue starts it now.`,
      action: 'Continue',
      pending: 'Starting…',
      failed: 'The stage didn’t start.',
    },
  },
  canvas: {
    title: 'Agents',
    description: 'Every agent of this run. Helpers sit beneath the agent that started them.',
    noAgents: 'No agents yet. They appear here once the run starts.',
    planning:
      'An agent is reading the code (without changing anything) and writing a plan. You approve the plan before any helper agent starts.',
    noHelpers: 'No helper agents yet. The lead agent starts them as the plan says.',
    select: (role: string) => `Show the ${role} in the side panel`,
    branchUnknown: 'No branch yet',
    needsYou: (n: number) => `${formatCount(n)} ${n === 1 ? 'request' : 'requests'} for you`,
    withHelpers: (n: string) => `With its helpers: ${n} budget tokens`,
    messagePlaceholderLead: 'Message the lead…',
    messagePlaceholderPlanner: 'Message the planner…',
    messagePlaceholder: 'Send a message…',
    messageLabel: (role: string) => `Message to the ${role}`,
    send: 'Send',
    sending: 'Sending…',
    sendFailed: "Your message wasn't sent.",
    tooLong: 'Keep it under 8,000 characters.',
  },
  panel: {
    label: 'Selected agent',
    tabs: {
      chat: 'Chat',
      activity: 'Activity',
      changes: 'Changes',
      checks: 'Checks',
      approvals: 'Approvals',
      details: 'Details',
    },
  },
  activity: {
    title: 'Activity',
    description: 'What this agent did, newest first. Only what happened, never what was said.',
    latest: 'Latest',
    noSession:
      'This agent is not linked to a Claude Code session yet, so only its latest activity is known.',
    empty: 'Nothing recorded yet.',
    loading: 'Loading activity…',
    openSession: 'Open its session for everything',
  },
  changes: {
    title: 'Changes',
    leadNone: 'The lead agent never changes files. Its helper agents do, each in its own copy.',
    readOnlyNone: 'This agent only reads; it never changes files.',
    notYet: 'Changes are shown here once this agent has stopped.',
    noReview: 'No changes recorded for this agent.',
    loading: 'Loading changes…',
    blocked: (names: string) =>
      `A required check failed (${names}), so Merge is blocked. Ask the agents to fix it, or merge anyway with a reason.`,
    checksPending: 'The checks have not run on these changes yet.',
    mergeAnyway: 'Merge anyway…',
    mergeAnywayTitle: 'Merge although a required check failed',
    reasonLabel: 'Why merge anyway?',
    reasonHint: 'Required. It is kept with the review.',
    reasonPlaceholder: 'For example: the build fails on main too; fixed in WEB-15.',
    reasonTooLong: 'Keep the reason under 500 characters.',
    confirmMergeAnyway: 'Merge anyway',
    cancel: 'Cancel',
  },
  checks: {
    title: 'Checks',
    description:
      "The project's harness checks, run in this agent's copy of the project before you merge.",
    tip: "The commands in the project's harness (.acp/harness.json), such as tests, lint and build. Required checks must pass before you merge.",
    none: 'No checks have run for this agent yet.',
    leadNone: "Checks run on helper agents' changes, not on the lead agent.",
    readOnlyNone: 'Checks run on changes, and this agent only reads.',
    required: 'Required',
    optional: 'Optional',
    duration: (d: string) => `took ${d}`,
    exitCode: (n: number) => `exit status ${n}`,
    noExitCode: 'no exit status',
    output: 'Output (last lines)',
    noOutput: 'No output.',
    earlier: (n: number) => `Earlier check runs (${formatCount(n)})`,
    summary: (passed: number, total: number) =>
      `${formatCount(passed)} of ${formatCount(total)} ${total === 1 ? 'check' : 'checks'} passed`,
    runAgain: 'Run checks again',
    running: 'Running…',
    runFailed: "The checks didn't run.",
  },
  approvals: {
    none: 'No requests from this agent.',
  },
  details: {
    agentId: 'Agent id',
    runId: 'Run id',
    kind: 'Kind',
    session: 'Claude Code session',
    noSession: 'Not linked yet',
    branch: 'Branch',
    baseBranch: 'Merges into',
    branchUnknown: 'Not known yet',
    model: 'Model',
    started: 'Started',
    ended: 'Ended',
    notEnded: 'Not ended',
    cost: 'Estimated cost',
    task: 'Task',
    noTask: 'None',
  },
  review: {
    title: 'Ready for your review',
    description:
      'The agents have stopped. Open each helper agent to look at its changes and checks, then merge or discard.',
    open: 'Review',
    files: (n: number | null) =>
      n === null ? 'Files not counted' : `${formatCount(n)} changed ${n === 1 ? 'file' : 'files'}`,
    checksFailed: 'A required check failed',
    checksPassed: 'Required checks passed',
    checksNone: 'Checks not run yet',
  },
  plan: {
    title: 'Plan',
    version: (n: number) => `Version ${formatCount(n)}`,
    helpers: (n: number) => `${formatCount(n)} helper ${n === 1 ? 'agent' : 'agents'} planned`,
    stepRole: 'Done by',
    intro:
      'An agent read the code and proposes this plan. No helper agent starts until you approve it.',
    approve: 'Approve plan',
    approving: 'Approving…',
    requestChanges: 'Request changes',
    sending: 'Sending…',
    commentLabel: 'What should change?',
    commentHint:
      'Required when you request changes. The agent that plans gets it and writes a new version.',
    commentPlaceholder:
      'For example: keep the old settings page; add the toggle to the header instead.',
    commentRequired: 'Say what should change.',
    failed: "Your decision wasn't saved.",
    earlier: (n: number) => `Earlier versions (${formatCount(n)})`,
    yourComment: 'Your comment',
    waitingNewVersion: 'A new version of the plan is being written.',
  },
  ticket: {
    title: 'Ticket',
    description: 'Description',
    noDescription: 'No description.',
    edit: 'Edit',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    titleLabel: 'Title',
    saveFailed: "Your changes weren't saved.",
    created: 'Created',
    ticketId: 'Ticket id',
  },
  comments: {
    title: 'Comments',
    empty: 'No comments yet.',
    you: 'You',
    lead: 'Lead agent',
    reviewer: 'Reviewer',
    reviewerTip:
      'Posted by the reviewer agent after the merge (the Final code review stage). Its findings never block a merge.',
    onPlan: (v: number) => `on plan version ${formatCount(v)}`,
    label: 'Add a comment',
    placeholder: 'Write a comment…',
    add: 'Comment',
    adding: 'Saving…',
    failed: "Your comment wasn't saved.",
  },
  history: {
    plans: 'Plan history',
    noPlans: 'No plans yet.',
    runs: 'Runs',
    noRuns: 'Not started yet.',
    run: (n: number) => `Run ${formatCount(n)}`,
    show: 'Show',
    showing: 'Shown above',
  },
} as const;

// --- The ticket page as a pull request page (v0.3.0 D-B) ---------------------------------------
// Add-only. The header, the four tabs, the timeline, the final-step box and the sidebar. The
// words inside each part (plan, comments, checks, branch, pull request) stay in their own sections.

export const TICKET_PAGE_COPY = {
  tabs: {
    label: 'Ticket sections',
    conversation: 'Conversation',
    agents: 'Agents',
    files: 'Files changed',
    checks: 'Checks',
    /** The count after a tab's name, for screen readers: "Files changed, 4". */
    count: (n: number) => formatCount(n),
  },
  header: {
    edit: 'Edit',
    editLabel: 'Edit the title',
    titleLabel: 'Title',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    failed: 'The title wasn’t saved.',
    /** "feature/WEB-21-saved-searches → main". */
    into: 'into',
    branchLabel: 'Branch',
    targetLabel: 'Target',
    /** G-H: "feature/WEB-21 → dev · from release/1.0". */
    from: 'from',
    fromLabel: 'Starts from',
    plannedTip:
      'The name this ticket’s branch will get. The run creates the branch when it starts; change it in Branch on the right.',
    agents: (n: number) => countOf(n, 'agent', 'agents'),
    /** The final step's main action in the header goes down to the final-step box. */
    goTo: (action: string) => `${action}: go to the final step`,
    needsYouTip: 'Show what waits for you',
  },
  conversation: {
    needsYou: 'Waiting for you',
    timeline: 'Timeline',
    description: 'Description',
    created: 'Created',
    editLabel: 'Edit the description',
    runStarted: (n: number) => `Run ${formatCount(n)} started`,
    showRun: 'Show this run',
    shownRun: 'Shown on this page',
    plan: (v: number) => `Plan version ${formatCount(v)}`,
    showPlan: 'Show the plan',
  },
  finalStep: {
    title: 'Final step',
    waiting: 'The agents are still working',
    ready: (target: string) => `Ready to merge into ${target}`,
    blocked: 'A required check failed on the tip',
    baseMoved: (target: string) => `${target} moved since this branch started`,
    prOpen: (n: number) => `Pull request #${n} is open on GitHub`,
    stopped: 'This run has stopped',
    merged: 'The ticket’s work is merged',
    discarded: 'The ticket branch was discarded',
    checks: (passed: number, total: number) =>
      `${formatCount(passed)} of ${formatCount(total)} ${total === 1 ? 'check' : 'checks'} passed on the tip`,
    checksFailed: (n: number) =>
      `${countOf(n, 'required check', 'required checks')} failed on the tip`,
    checksStopped: 'The checks on the tip didn’t finish',
    checksNone: 'No checks have run on the tip yet',
    prNote: 'Its link, state and Refresh are in Pull request on the right.',
  },
  sidebar: {
    label: 'About this ticket',
    pullRequest: 'Pull request',
    noPullRequest: 'None yet. You can open one in the final step.',
    labels: 'Labels',
    noLabels: 'None',
    type: 'Type',
    priority: 'Priority',
    thisRun: 'This run',
    noRun: 'Not started yet.',
    runOf: (n: number, total: number) => `Run ${formatCount(n)} of ${formatCount(total)}`,
    started: 'Started',
    budget: 'Budget tokens used',
    budgetTip:
      'Budget tokens are the app’s own count of what this run’s agents used, against each agent’s limit. Every agent counts once.',
    approvals: 'Approvals',
    sessions: 'Sessions',
    noSessions: 'No Claude Code sessions yet.',
    sessionOf: (role: string) => `${role}’s session`,
    details: 'Details',
  },
  files: {
    branchTitle: 'Ticket branch',
    reviewAll: 'Review all files',
    reviewAllTip: 'Opens every file of the ticket branch on one page, with comments on lines.',
    changesTitle: 'Changes in this run',
    changesNone: 'No changes yet. Each helper’s change shows here once it has one.',
    filesChanged: 'Files changed',
    filesChangedFor: (role: string) => `Files changed by the ${role}`,
    open: 'Open',
    openFor: (role: string) => `Open the ${role}’s change`,
    noRun: 'Nothing has changed yet. Changes show here once a run has them.',
    helpersTitle: 'Changes of each helper',
  },
  checks: {
    tipTitle: 'Checks on the tip',
    changesTitle: 'Checks on each change',
    noRun: 'No checks yet. They run on each change and on the ticket branch.',
    none: 'No agent in this run changes files, so no checks run.',
  },
  agents: {
    noRun: 'No agents yet. They appear here once the run starts.',
  },
} as const;

// --- Shell, All projects and the command palette (redesign R-A, wp/r-a-shell) ------------------
// Add-only. Page WPs add their own sections below; nav labels for their pages live here.

export const SHELL_COPY = {
  topBar: { label: 'App bar', home: 'Agent Control Plane home' },
  nav: {
    label: 'Main',
    project: 'Project',
    pages: {
      board: 'Board',
      workflow: 'Workflow',
      skills: 'Skills & Agents',
      harness: 'Harness',
      tokens: 'Tokens',
      sessions: 'Sessions',
      settings: 'Settings',
    },
    allProjects: 'All projects',
    health: 'Data health',
    /** The heading over All projects and Data health (v0.3.0 D-0, owner request). */
    workspace: 'Workspace',
  },
  switcher: {
    button: (name: string) => `Project: ${name}. Switch project`,
    none: 'Choose a project',
    unknown: 'Unknown project',
    allProjects: 'All projects',
    menu: 'Switch project',
    yourProjects: 'Your projects',
    newProject: 'New project',
    empty: 'No projects yet.',
  },
  palette: {
    open: 'Search or jump to…',
    shortcut: '⌘K',
  },
  /** The theme menu (v0.3.0 D-0): in the top bar and in Settings. */
  theme: {
    label: (word: string) => `Theme: ${word}. Change theme`,
    tip: 'Theme',
    menu: 'Theme',
    options: { light: 'Light', dark: 'Dark', system: 'System' },
    /** What System follows, under its name. */
    systemHint: 'Follows your computer',
    settingsTitle: 'Appearance',
    settingsText: 'How the app looks in this browser.',
  },
  health: {
    tabs: 'Data health sections',
    overview: 'Overview',
    connection: 'Connection',
  },
  redirect: {
    opening: 'Opening…',
    ticketMissing: {
      title: 'Ticket not found',
      text: 'There is no ticket at this address. It may have been removed.',
    },
    runMissing: {
      title: 'Run not found',
      text: 'There is no run at this address. It may have been removed.',
    },
  },
  notFound: { action: 'Go to All projects' },
} as const;

export const ALL_PROJECTS_COPY = {
  title: 'All projects',
  description: 'Every project you added, what its agents are doing, and what needs you.',
  newProject: 'New project',
  addFolder: 'Add an existing folder',
  cardsLabel: 'Your projects',
  agents: 'Agents',
  sessionsLabel: 'Claude Code sessions',
  sessions: (n: number) => countOf(n, 'session'),
  running: (n: number) => `${formatCount(n)} running`,
  needsYou: (n: number) => `${formatCount(n)} ${n === 1 ? 'needs' : 'need'} you`,
  runsTip:
    "Agent runs working on this project's tickets right now, and the approvals or plan reviews waiting for you.",
  runsUnavailable: 'Board not available',
  harness: 'Harness',
  lastActivity: 'Last activity',
  noActivity: 'No activity yet',
  across: {
    title: 'Across your projects',
    tip: 'Claude Code sessions in all your projects: what runs now, what waits for you, and the tokens they used.',
  },
  empty: {
    title: 'Add your first project',
    text: 'Pick a folder where you use Claude Code, or create a new repository. Everything else is per project.',
  },
} as const;

export const PALETTE_COPY = {
  title: 'Command palette',
  input: 'Search projects, pages and tickets',
  placeholder: 'Jump to a project, page or ticket…',
  results: 'Results',
  none: 'Nothing matches.',
  loadingTickets: 'Loading tickets…',
  groups: {
    actions: 'Actions',
    pages: 'Pages',
    projects: 'Projects',
    tickets: 'Tickets',
  },
  newTicket: 'New ticket',
  newTicketIn: (project: string) => `New ticket in ${project}`,
  newProject: 'New project',
  hint: '↑↓ to move · Enter to open · Esc to close',
} as const;

// --- Harness page (redesign R-E, wp/r-e-harness) -----------------------------------------------
// Add-only. Check results reuse CHECK_STATUS_COPY and ticket stages TICKET_STAGE_COPY (above).

/** "90 s", "5 min", "1 min 30 s": a check's time limit. */
export function formatSeconds(sec: number): string {
  if (sec < 60) return `${formatCount(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${formatCount(m)} min` : `${formatCount(m)} min ${s} s`;
}

export const HARNESS_PAGE_COPY = {
  title: 'Harness',
  description: "Does this project have checks for the agents' work, and do they pass?",
  tip: 'A harness is the project’s own checks (tests, lint, build), listed in .acp/harness.json in the repository. Agents use them to verify their changes, and you see the results before you merge.',
  loading: 'Reading the harness…',
  status: {
    title: 'Status',
    headline: {
      none: 'No harness yet',
      invalid: 'Invalid',
      partial: 'Partial',
      ready: 'Ready',
    },
    text: {
      none: 'This project has no checks for agents yet, so nothing is checked before a merge.',
      invalid: "The checks file can't be used. Until it is fixed, no checks run.",
      partial: 'Checks are set up, but none is required, so nothing has to pass before a merge.',
      ready: 'Checks are set up, and the required ones must pass before a plain merge.',
    },
    problems: 'What needs fixing',
    readAt: 'Read from the repository',
    refresh: 'Check again',
    refreshing: 'Checking…',
    cacheTip:
      'This page reads the project folder each time. After a merge, the board and the project cards can show the old harness state for about 10 seconds.',
    counts: (total: number, required: number) =>
      `${countOf(total, 'check')} · ${formatCount(required)} required`,
  },
  build: {
    text: 'Nothing is checked before a merge yet. A ready-written ticket lets an agent add the checks.',
    buildTip:
      'The ticket asks an agent to add fast checks and write .acp/harness.json. You approve its plan and review its changes like any other ticket. Expect one question while it works: writing into a folder that doesn’t exist yet (.acp) always asks you, even when edits are pre-approved.',
    create: 'Build the harness',
    creating: 'Creating the ticket…',
    failed: "The ticket couldn't be created.",
    ticket: 'Harness ticket',
    open: 'Open ticket',
    created: (key: string) => `Added ${key} to the board. Start it from there.`,
    noChecks: 'Its review runs no checks',
    noChecksTip:
      'Checks are read from your project folder, never from the agent’s copy. The new checks run once you merge this ticket’s changes; then use Run checks now.',
    newFolder: 'It asks you before creating .acp/harness.json',
    newFolderTip:
      'Writing into a folder that doesn’t exist yet (.acp) always asks you first, even when edits are pre-approved.',
  },
  checks: {
    title: 'Checks',
    description: 'Listed in .acp/harness.json and run one at a time.',
    tip: 'Each command runs directly, without a shell, in a temporary copy of the project. It is stopped when it runs past its time limit.',
    label: 'Harness checks',
    name: 'Check',
    command: 'Command',
    folder: 'Folder',
    timeLimit: 'Time limit',
    projectFolder: 'Project folder',
    required: 'Required',
    optional: 'Optional',
    requiredTip: 'Must pass before a plain merge.',
    optionalTip: 'Shown with the results, but never blocks a merge.',
    none: 'No checks listed',
    noneText: 'The harness file lists no checks yet.',
  },
  runs: {
    title: 'Runs on the main branch',
    tip: 'Run checks now runs every check on a temporary copy of the main branch’s last commit. Your files are not changed, and uncommitted changes to .acp/harness.json are not used.',
    run: 'Run checks now',
    running: 'Running checks…',
    runningText: 'The checks run one at a time. This can take as long as their time limits.',
    unavailable: 'Checks can run once the project has a valid harness.',
    description: 'Every run of the checks on the main branch, newest first.',
    loading: 'Loading earlier runs…',
    latest: 'Latest run',
    started: 'Started',
    earlier: 'Earlier runs',
    summary: (passed: number, total: number) =>
      `${formatCount(passed)} of ${countOf(total, 'check')} passed`,
    requiredFailed: (n: number) => `${countOf(n, 'required check')} did not pass`,
    noResults: 'No checks ran.',
    noResultsText:
      'The main branch’s last commit has no usable harness file. Merge or commit .acp/harness.json first.',
    resultsLabel: 'Check results',
    duration: (text: string) => `took ${text}`,
    exitCode: (code: number | null) =>
      code === null ? 'No exit code reported' : `Exit code ${formatCount(code)}`,
    output: 'Output (last part)',
    noOutput: 'No output.',
    empty: 'No runs yet',
    emptyText: 'Run the checks on the main branch to see whether they pass.',
    failed: "The checks couldn't be run.",
    errors: {
      checks_running:
        'Checks are already running on the main branch, maybe from another tab. Wait for them to finish, then try again.',
      not_a_git_repo:
        'The project folder is not a git repository, so there is no main branch to check.',
      no_commits: 'The project has no commits yet, so there is no main branch to check.',
      invalid_root: "The project folder can't be used. Check that it still exists.",
      not_found: 'This project was not found. It may have been removed.',
    } as Readonly<Record<string, string>>,
  },
  usage: {
    title: 'Where checks run',
    review: {
      title: "When a ticket's work enters review",
      text: "Each helper's changes are checked in its own copy of the project.",
      tip: 'Right after a ticket enters review, its checks start by themselves. Until they finish, “Run checks again” on the ticket answers that checks are already running.',
    },
    demand: {
      title: 'When you ask',
      text: "Here, on the main branch, or on a ticket for one helper's changes.",
    },
    merge: {
      title: 'Before a merge',
      text: 'A failed required check blocks a plain merge. “Merge anyway” needs a reason, which is kept on the ticket.',
    },
    workflow: 'Review & merge in the workflow',
  },
  palette: {
    runChecks: 'Run checks',
    keywords: 'harness checks tests lint build verify main branch',
  },
} as const;

// --- Project Tokens page (redesign R-F, wp/r-f-tokens) -------------------------------------------

export type TokensBreakdownWord = 'session' | 'ticket' | 'role' | 'model';
export type TokensRoleWord = 'planner' | 'lead' | 'worker' | 'reviewer' | 'tester' | 'external';

/** "94%"; below 1% keeps one decimal so a small share never reads as 0%. */
export function formatShare(share: number): string {
  const pct = share * 100;
  if (pct > 0 && pct < 1) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

export const TOKENS_COPY = {
  title: 'Tokens',
  description: "What this project's sessions used: new work, and what the prompt cache reused.",
  tip: 'Every number comes from the usage Claude Code reported, with each reply counted once. Token types are priced differently, so new work and cache reuse are shown apart.',
  derivedTip:
    'Derived: summed from the usage Claude Code reported, each reply counted once. Helper agents count under themselves.',
  tiles: {
    label: 'Tokens at a glance',
    countsLabel: 'Sessions and runs',
    sessions: 'Sessions',
    sessionsTip: 'One Claude Code conversation, from when it starts until it exits.',
    sessionsWithUsage: (n: number) => `${formatCount(n)} reported token usage`,
    runs: 'Agent runs',
    runsTip: "Runs this app started for the project's tickets: a lead agent and its helpers.",
    runsTickets: (n: number) => (n === 1 ? 'for 1 ticket' : `for ${formatCount(n)} tickets`),
    newWork: 'New work',
    newWorkTip:
      'Input and output tokens: what was newly sent to the model, and what it wrote back.',
    newWorkSub: 'input + output tokens',
    total: 'Total processed',
    totalTip:
      'Everything the model read and wrote: input, output, cache write and cache read tokens added up. Cache tokens are much cheaper, so this is not a cost.',
    totalSub: 'including the prompt cache',
    share: 'Cache reuse share',
    shareTip: 'Cache read tokens as a share of the total processed.',
    shareWhy:
      'Every turn re-reads the conversation from the cache, so this share is usually large.',
    tokens: (n: number) => `${formatCount(n)} ${n === 1 ? 'token' : 'tokens'}`,
    partial: 'Partial',
    partialNote: (missing: number, total: number) =>
      `At least ${formatCount(missing)} of ${formatCount(total)} usage records didn't report every type counted here, so the real number may be higher.`,
  },
  charts: {
    title: 'Over time',
    tip: 'Cache tokens are often about 1,000 times more than new work, so they get their own chart and scale.',
    newWork: 'New work per day',
    cache: 'Prompt cache per day',
    note: "Lines are not stacked. A gap means that day didn't report this type; it is not zero. Days with no usage are left out.",
    showTable: 'Show as table',
    showChart: 'Show as chart',
    tableLabel: 'Tokens per day',
    day: 'Day',
    dayAxis: 'Day (UTC)',
    tokensAxis: 'Tokens',
    undated: (n: number) =>
      n === 1
        ? '1 usage record has no date, so it is not on the charts. It is in the numbers above and the tables below.'
        : `${formatCount(n)} usage records have no date, so they are not on the charts. They are in the numbers above and the tables below.`,
  },
  breakdown: {
    title: 'Where the tokens went',
    description: "Each session's own tokens, counted once. Helper agents count under themselves.",
    by: 'Break down by',
    words: {
      session: 'Session',
      ticket: 'Ticket',
      role: 'Agent role',
      model: 'Model',
    } satisfies Record<TokensBreakdownWord, string>,
    tableLabel: (word: string) => `Tokens by ${word.toLowerCase()}`,
    newWork: 'New work',
    cacheWrite: 'Cache write',
    cacheRead: 'Cache read',
    total: 'Total processed',
    share: 'Cache share',
    fromCache: 'from cache',
    writePrefix: 'write',
    inOut: (input: string, output: string) => `${input} in · ${output} out`,
    cost: 'Estimated cost',
    costProvenance: 'estimated (provider-reported)',
    costTip:
      "The latest running total Claude Code reported for this session. An estimate; this app doesn't calculate prices, and costs are never added up across sessions.",
    unknownModel: 'Unknown model',
    empty: {
      session: 'No session used tokens in this range.',
      ticket: 'No ticket has an agent run in this range.',
      role: 'No usage in this range.',
      model: 'No usage in this range.',
    } satisfies Record<TokensBreakdownWord, string>,
    ticketNote:
      "A ticket's tokens are its agents' sessions. A ticket whose agents haven't reported usage yet reads \"Not reported\".",
    roleNote: 'Sessions you started yourself in Claude Code count as "Outside the app".',
  },
  roles: {
    planner: { word: 'Planner', tip: 'Writes the plan for a ticket.' },
    lead: { word: 'Lead', tip: 'Runs the approved plan and starts the helpers.' },
    worker: { word: 'Helpers', tip: 'Do parts of the work, each in its own copy of the project.' },
    reviewer: { word: 'Reviewer', tip: 'Reviews the merged change.' },
    tester: { word: 'Tester', tip: 'Writes unit tests for the change.' },
    external: {
      word: 'Outside the app',
      tip: 'Sessions you started yourself in Claude Code, not by an agent run.',
    },
  } satisfies Record<TokensRoleWord, { word: string; tip: string }>,
  range: {
    label: 'Date range',
    presets: {
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
      all: 'All time',
      custom: 'Custom',
    } satisfies Record<DatePreset, string>,
    from: 'From',
    to: 'To',
    utcNote: 'Days are counted in UTC.',
  },
  empty: {
    title: 'No token usage yet',
    text: "Tokens appear here once this project's Claude Code sessions report usage.",
    /** The project has sessions or agent runs, but none reported usage yet. */
    withRuns:
      'Usage appears here once the app observes these Claude Code sessions and they report tokens.',
  },
  emptyRange: {
    title: 'No token usage in this range',
    text: 'Try a longer date range.',
  },
} as const;

// --- Workflow page (redesign R-B, wp/r-b-workflow) ---------------------------------------------
// Add-only. The process graph, the stage panel and the agent files list (docs/redesign §4.2).

export const WORKFLOW_COPY = {
  title: 'Workflow',
  description: 'How agents work on a ticket, from plan to merge. Select a stage to change it.',
  tip: 'The stages are fixed for now: you can turn the optional ones on or off and give each agent a model, a skill and an agent file. Editable workflows, with your own agents and connections, come later.',
  flowSentence:
    'An agent plans the ticket and you approve the plan. The lead then hands parts to helpers, each in its own copy of the project. You merge their work once the required checks pass. A reviewer and a tester can follow.',
  graphLabel: 'Workflow graph',
  graphTitle: 'How a ticket flows',
  loading: 'Loading the workflow…',
  roles: {
    planner: 'Planner',
    lead: 'Lead',
    helper: 'Helpers',
    reviewer: 'Reviewer',
    tester: 'Tester',
  },
  roleTips: {
    planner: 'A read-only agent that writes the plan and revises it on your comments.',
    lead: 'The main agent of a run. It reads your project but never edits it, and hands parts of the ticket to helpers.',
    helper: 'Agents that each work on one part of the ticket, in their own copy of the project.',
    reviewer:
      'A read-only agent that reads the merged result and posts its findings as ticket comments. It never blocks a merge.',
    tester:
      'An agent that writes unit tests for the merged change in its own copy. Its change goes through review and merge too.',
  },
  workspace: {
    'read-only': 'Read-only',
    'own-worktree': 'Own copy',
  },
  workspaceTips: {
    'read-only': 'Reads your project but cannot change any file.',
    'own-worktree':
      'Works in its own copy of the project (a git worktree). Nothing reaches your files until you merge it.',
  },
  stages: {
    plan: 'Plan',
    orchestrate: 'Orchestrate',
    helpers: 'Helpers',
    review: 'Review & merge',
    'code-review': 'Final code review',
    'unit-tests': 'Unit tests',
  },
  stageText: {
    plan: 'Reads the ticket and the project, then proposes a plan for you to approve.',
    orchestrate: 'Starts helpers for the parts of the approved plan and follows their progress.',
    helpers: 'Each helper works on one part of the plan in its own copy of the project.',
    review:
      'You review each helper’s change and merge it. The harness checks run first, and required ones must pass.',
    'code-review':
      'After the merge, a read-only reviewer reads the result and posts findings as ticket comments.',
    'unit-tests':
      'After the merge, a tester writes unit tests in its own copy. You review and merge them like any change.',
  },
  ticket: 'Ticket',
  done: 'Done',
  approve: {
    who: 'You',
    title: 'Approve the plan',
    text: 'Approve it, or ask for changes.',
    tip: 'No helper starts until you approve the plan. This is always on for now.',
  },
  review: {
    who: 'You + harness checks',
    checks: 'Required checks must pass',
    merge: 'You merge each change',
  },
  sameAgent: 'Same agent',
  sameAgentTip: (other: string) =>
    `One lead agent plans and then orchestrates. It also covers “${other}”. Turn on “Separate planner agent” to split them.`,
  off: 'Off',
  optionalOn: 'On',
  optionalTip: 'An optional stage. Turn it on or off in its panel.',
  model: 'Model',
  projectDefault: 'Project default',
  projectDefaultNamed: (model: string) => `${model} (default)`,
  noSkill: 'No skill',
  skillChip: (name: string) => `✦ ${name}`,
  skillMissing: 'missing',
  skillMissingTip: (name: string) =>
    `The skill “${name}” is no longer in this project. The agent starts without it until you pick another one.`,
  helperName: (i: number) => `Helper ${i}`,
  nestedHint: '↳ may start helpers',
  nestedTip: 'Helper depth 2: this helper may start its own helpers, within the same limit.',
  helperFacts: (max: number, depth: number, budget: string) =>
    `Up to ${max} · depth ${depth} · ${budget} each`,
  select: (stage: string) => `Change ${stage}`,
  edges: {
    loop: 'Changes',
    bypass: 'Off: skipped',
  },
  legend: {
    label: 'Legend',
    flow: 'The path a ticket takes',
    loop: 'Asking for changes sends the plan back',
    bypass: 'Skips a stage that is off',
    agent: 'An agent',
    you: 'You decide',
    skill: 'The project skill the agent uses',
  },
  panel: {
    label: 'Stage settings',
    empty: 'Select a stage in the graph to change it.',
    close: 'Close stage settings',
    separatePlanner: 'Separate planner agent',
    separatePlannerHint:
      'Off: one lead agent plans and then runs the helpers (how it works today). On: a read-only planner writes the plan, and the lead starts after you approve it.',
    modelHint: 'Leave empty to use the project default. Change the default in Settings.',
    modelPlaceholderDefault: 'Claude Code’s default',
    skill: 'Skill',
    skillHint: 'The agent is told to use this project skill.',
    skillMissingOption: (name: string) => `${name} (missing)`,
    enabled: 'Run this stage',
    depthValue: (d: number) =>
      d === 1 ? 'Only the lead starts helpers' : 'Helpers may start their own helpers',
    enabledHint: 'Off by default. When on, it runs after everything is merged.',
    limitsTitle: 'Limits',
    limitsNote: 'Shared with Settings. They also apply to the reviewer and the tester.',
    allowlistTitle: 'Pre-approved actions',
    requireChecks: 'Required checks must pass',
    requireChecksHint:
      'Always on. A change can only be merged when every required harness check passes, so a failing check never reaches your main branch. The merge itself is always your click.',
    harnessLink: 'Open the Harness page',
    save: 'Save',
    saving: 'Saving…',
    discard: 'Discard changes',
    unsaved: 'Unsaved changes',
    saved: 'Saved',
    errors: {
      modelTooLong: 'Use a shorter model name (at most 100 characters).',
    },
  },
  refusals: {
    csrf: 'The app’s security check failed. Reload the page and try again.',
    invalid: 'The server didn’t accept these settings.',
    notFound: 'This project no longer exists in the app.',
    conflict: 'Another project already uses this ticket prefix. Change it in Settings.',
    unreachable: 'The server isn’t reachable. Your changes are still here; try again.',
    generic: 'The changes couldn’t be saved.',
    workflow: 'Stage settings weren’t saved.',
    limits: 'Helper limits weren’t saved.',
    workflowSavedFirst: 'The stage settings were saved; only the helper limits are left.',
  },
  agents: {
    title: 'Agent files',
    tip: 'Claude Code agent definitions in this project’s .claude/agents folder. Pick one for a stage in its panel: its instructions are added, its model is the stage default, and its tools can only narrow the role’s tools.',
    description: 'Each stage can use one. Pick it in the stage’s panel.',
    empty: 'No agent files in .claude/agents.',
    allTools: 'All tools',
    tools: (n: number) => countOf(n, 'tool'),
    loading: 'Loading agent files…',
  },
} as const;

// --- Skills page (redesign, wp/r-d-skills) ------------------------------------------------------
//
// Project skills: `.claude/skills/<name>/SKILL.md` in the project's repository (ADR-0018).

import type { WorkflowStageId } from '@acp/core';

export const SKILLS_COPY = {
  page: {
    title: 'Skills & Agents',
    description:
      'Skills and agent definitions for this project, saved as files in its repository so they are versioned with your code. Claude Code loads them by name.',
    tabs: 'Skills or agents',
    skillsTab: 'Skills',
    agentsTab: 'Agents',
    newSkill: 'New skill',
    back: 'All skills',
    loading: 'Loading skills…',
    tip: 'A skill is a SKILL.md file in .claude/skills/<name>/; a workflow stage that names a skill tells its agent to use it. An agent definition is a .claude/agents/<name>.md file (a Claude Code subagent). Your personal ~/.claude is never shown or changed here.',
  },
  empty: {
    title: 'No skills yet',
    text: 'Start from a template, or write one from scratch. A skill is saved as a file in this project, so it is versioned and reviewed with your code.',
    blank: 'Blank skill',
  },
  card: {
    usedBy: 'Used by',
    notUsed: 'Not used by any stage',
    uncommitted: 'Uncommitted',
    uncommittedTip:
      'The file in your working tree differs from the last commit, or was never committed. Open the skill and press Commit to record it.',
    lastCommitted: 'Last committed',
    neverCommitted: 'Never committed',
    noDescription: 'No description',
    problems: (n: number) => (n === 1 ? '1 problem' : `${formatCount(n)} problems`),
    open: (name: string) => `Open skill ${name}`,
  },
  stages: {
    plan: 'Plan',
    orchestrate: 'Orchestrate',
    helpers: 'Helpers',
    review: 'Review and merge',
    'code-review': 'Final code review',
    'unit-tests': 'Unit tests',
  } satisfies Record<WorkflowStageId, string>,
  editor: {
    newTitle: 'New skill',
    editTitle: (name: string) => name,
    newDescription: 'Saved to .claude/skills/<name>/SKILL.md in this project.',
    name: 'Name',
    nameHint:
      'Lowercase letters, digits and dashes. It is the folder name and cannot be changed later.',
    nameInvalid:
      'Use lowercase letters, digits and dashes, starting with a letter or digit (up to 64).',
    nameTaken: 'A skill with this name already exists.',
    description: 'When to use it',
    descriptionHint:
      'One or two sentences. Claude Code reads this to decide when the skill applies.',
    descriptionRequired: 'Say when the skill should be used.',
    instructions: 'Instructions',
    write: 'Write',
    preview: 'Preview',
    previewEmpty: 'Nothing to preview yet.',
    size: (used: string) => `${used} of 64 KB`,
    tooLarge: 'The skill is larger than 64 KB. Shorten the instructions.',
    templates: 'Start from a template',
    templatesHint: 'Replaces the description and instructions below.',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    saved: 'Saved to your working tree. It is not committed yet.',
    unsaved: 'Unsaved changes',
    path: 'File',
  },
  commit: {
    title: 'Commit',
    button: 'Commit',
    committing: 'Committing…',
    explain:
      "Commit creates a git commit with only this skill's folder, on the branch you have checked out. Nothing else is included and nothing is pushed.",
    clean: 'Everything in this skill is committed.',
    saveFirst: 'Save your changes before committing.',
    done: (commit: string, branch: string) => `Committed ${commit.slice(0, 7)} on ${branch}.`,
    removal: (name: string) => `Deleted ${name}. Commit to record the removal in git.`,
    commitRemoval: 'Commit removal',
  },
  remove: {
    button: 'Delete skill',
    title: (name: string) => `Delete ${name}?`,
    text: (path: string) =>
      `This removes ${path} from your working tree. Other files in its folder stay. Commit afterwards to record the removal.`,
    confirm: 'Delete',
    deleting: 'Deleting…',
    cancel: 'Cancel',
    inUse: (stages: string) =>
      `Used by ${stages}. Remove it from those stages on the Workflow page before deleting it.`,
  },
  problems: {
    title: 'Problems',
  },
  /** Friendly words for the server's typed refusals; the server's own sentence follows. */
  refusals: {
    csrf_missing: 'The app could not confirm this was you. Reload the page and try again.',
    csrf_invalid: 'The app could not confirm this was you. Reload the page and try again.',
    conflict: 'A skill with this name already exists.',
    not_found: 'This skill no longer exists.',
    skill_in_use: 'A workflow stage still uses this skill.',
    unsafe_path:
      'The skill folder is a link or points outside the project, so the app will not touch it.',
    too_large: 'The skill is larger than 64 KB.',
    staged_changes:
      'Other files are staged in git. Commit or unstage them first, so the skill commit holds only the skill.',
    nothing_to_commit: 'There is nothing to commit for this skill.',
    detached_head: 'No branch is checked out in the project, so there is nowhere to commit.',
    not_a_git_repo: 'The project folder is not a git repository.',
    git_failed: 'git could not finish the commit.',
    fallback: 'That did not work.',
  } as Record<string, string>,
} as const;

/** The Agents tab: `.claude/agents/<name>.md`, Claude Code subagents (ADR-0018 amendment). */
export const AGENTS_COPY = {
  page: {
    intro:
      'Agent definitions are Claude Code subagents: a name, when to use it, which tools it may use, a model and its instructions. A workflow stage can use one: pick it in the stage’s panel on the Workflow page.',
    newAgent: 'New agent',
    back: 'All agents',
    loading: 'Loading agents…',
  },
  empty: {
    title: 'No agent definitions yet',
    text: 'Start from a template, or write one from scratch. Each agent is one file in .claude/agents/, versioned and reviewed with your code.',
    blank: 'Blank agent',
  },
  card: {
    tools: 'Tools',
    allTools: 'All tools',
    noTools: 'No tools',
    model: 'Model',
    defaultModel: 'Default model',
    more: (n: number) => `+${formatCount(n)} more`,
    open: (name: string) => `Open agent ${name}`,
  },
  editor: {
    newTitle: 'New agent',
    newDescription: 'Saved to .claude/agents/<name>.md in this project.',
    nameHint:
      'Lowercase letters, digits and dashes. It is the file name and cannot be changed later.',
    nameTaken: 'An agent with this name already exists.',
    descriptionHint:
      'One or two sentences. Claude Code reads this to decide when to hand work to the agent.',
    tools: 'Tools',
    allTools: 'All tools',
    allToolsHint:
      "The agent can use every tool your session has (Claude Code's default). Turn this off to choose.",
    toolsHint: 'Type a tool name and press Enter, or pick a common one below.',
    addTool: 'Add tool',
    removeTool: (tool: string) => `Remove ${tool}`,
    toolInvalid:
      'A tool name starts with a letter and has no spaces, for example Read or mcp__github__get_pr.',
    toolsNone: 'No tools chosen: the agent can only read the conversation it is given.',
    common: 'Common tools',
    model: 'Model',
    modelHint: 'Leave empty to use the default. For example sonnet, opus, haiku or inherit.',
    modelPlaceholder: 'Default model',
    modelTooLong: 'A model name has at most 100 characters.',
    tooLarge: 'The agent file is larger than 64 KB. Shorten the instructions.',
  },
  commit: {
    explain:
      'Commit creates a git commit with only this agent file, on the branch you have checked out. Nothing else is included and nothing is pushed.',
    clean: 'Everything in this agent file is committed.',
  },
  remove: {
    button: 'Delete agent',
    text: (path: string) =>
      `This removes ${path} from your working tree. Commit afterwards to record the removal.`,
  },
  refusals: {
    conflict: 'An agent with this name already exists.',
    not_found: 'This agent definition no longer exists.',
    unsafe_path:
      'The agents folder or file is a link or points outside the project, so the app will not touch it.',
    too_large: 'The agent file is larger than 64 KB.',
    staged_changes:
      'Other files are staged in git. Commit or unstage them first, so the commit holds only this agent file.',
    nothing_to_commit: 'There is nothing to commit for this agent.',
    agent_in_use: 'A workflow stage still uses this agent file.',
  } as Record<string, string>,
} as const;

/** "Plan, Helpers and Final code review". */
export function stageList(stages: readonly WorkflowStageId[]): string {
  const words = stages.map((s) => SKILLS_COPY.stages[s]);
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}

// --- Agent files on workflow stages (redesign R-I, wp/r-i-web) ----------------------------------
//
// Add-only. A stage uses one project agent file, `.claude/agents/<name>.md` (docs/redesign §6a,
// ADR-0019 §6): the picker in the stage panel, the chip on graph nodes, and "Used by".

export const STAGE_AGENT_COPY = {
  label: 'Agent file',
  none: 'None',
  hint: 'Its instructions are added to this stage’s agent, and its model is used when the stage has none. Its tools can only narrow what this role may do.',
  readOnlyHint: 'This role stays read-only whatever the file lists.',
  leadModeNote:
    'One lead agent does Plan and Orchestrate. It uses Orchestrate’s agent file, or Plan’s when Orchestrate has none.',
  missingOption: (name: string) => `${name} (not found)`,
  missing: 'not found',
  missingTip: (name: string) =>
    `Agent file not found: .claude/agents/${name}.md. The agent starts without it.`,
  missingWarning: 'Agent file not found — the agent starts without it.',
  problems: 'This file has problems, so the agent may start without it:',
  chipTip: (name: string) =>
    `This stage’s agent uses .claude/agents/${name}.md: its instructions, its model when the stage has none, and only the tools the role allows.`,
  manage: 'Open Skills & Agents',
  modelPlaceholder: (model: string) => `From agent file: ${model}`,
  modelHint: 'Leave empty to use the agent file’s model, else the project default.',
  modelFromFile: (model: string) => `${model} (agent file)`,
  modelFromFileSuffix: '(agent file)',
  modelFileOrDefault: 'Agent file or default',
  legend: 'The agent file the stage uses',
  usedBy: 'Used by',
  notUsed: 'Not used by any stage',
  openStage: (stage: string) => `Open ${stage} on the Workflow page`,
  selectStage: (stage: string) => `Open the ${stage} settings`,
} as const;

// --- The lead's chat after the lead ends (redesign R-J, wp/r-j-web) -----------------------------
//
// Add-only. Once a run's lead has ended, an owner message brings it back for one answers-only turn
// (docs/history/redesign/README.md §6b, ADR-0020): the line above the box, the wait for the answer,
// why a chat can't be continued, and the follow-up bubbles.

import type { FollowUpUnavailableReason } from '@acp/core/api';

export const FOLLOW_UP_COPY = {
  available:
    'The lead has finished. A message brings it back to answer questions; it can’t change code. New work needs a new run.',
  running: 'The lead is answering…',
  placeholder: 'Ask the lead about this run…',
  /** One sentence per reason (ADR-0020 §5); no box is shown. */
  unavailable: {
    'no-session': 'This lead never started a conversation, so it can’t be continued.',
    'session-gone':
      'Claude Code no longer has this conversation (it ages out after 30 days), so it can’t be continued.',
    'managed-off': 'Managed agents are off in this app, so this chat can’t be continued.',
  } satisfies Record<FollowUpUnavailableReason, string>,
  /** When the server says `unavailable` without a reason. */
  unavailableFallback: 'This chat can’t be continued.',
  tag: 'Follow-up',
  tagTip: 'Said after the run ended. The lead came back to answer; it reads but changes nothing.',
  divider: 'After the run ended',
} as const;

// --- UI refresh, remaining pages (U-F, wp/u-f-pages) --------------------------------------------
//
// Add-only. Words the refreshed pages need that had no home yet; the same text as before.

export const PAGES_REFRESH_COPY = {
  /** The loading words under a page-shaped skeleton (screen readers only), as QueryView says. */
  loading: 'Loading…',
} as const;

// --- Shell frame (UI refresh U-B, wp/u-b-shell) ------------------------------------------------
// Add-only. Strings for the new shell controls only; every other shell word stays in SHELL_COPY.

export const SHELL_FRAME_COPY = {
  /** The top bar's trail: the project switcher, then the page. */
  breadcrumb: 'Breadcrumb',
  // The toggle at the top of the sidebar (v0.3.0 D-0, the owner's words).
  sidebar: {
    collapse: 'Hide sidebar',
    expand: 'Show sidebar',
  },
  /** The sidebar toggle's shortcut as the keyboard labels it (⌘ on Apple keyboards). */
  sidebarShortcut: (mac: boolean) => (mac ? '⌘B' : 'Ctrl+B'),
  /**
   * The short name next to the logo in the top bar (v0.3.0 C-S, the owner's words). The full name
   * (`APP_NAME`) is its tooltip and, with "home", the link's accessible name.
   */
  shortName: 'ACP',
} as const;

// --- Review loop: approval modes, Start dialog, change cards, ticket branch (RL-D, wp/rl-d-web) --
//
// Add-only (ADR-0021, docs/history/review-loop/README.md §7). Words for the approval modes, the
// review stage, the Start dialog, the change cards, the ticket branch and the live graph's
// additions.

const MODE_WORDS: Readonly<Record<ApprovalMode, string>> = {
  manual: 'Manual',
  'auto-edits': 'Auto edits',
  auto: 'Auto',
  'full-auto': 'Full auto',
};

/** The state chip of one helper's change ("Rework round 1 of 2", "Merged into acp/WEB-12"). */
export function changeStateWord(
  state: ChangeState,
  o: { round: number; max: number; branch: string | null },
): string {
  switch (state) {
    case 'sealing':
    case 'ready':
      return 'Ready';
    case 'reviewing':
      return 'In review';
    case 'decision':
      return 'Needs lead decision';
    case 'rework':
      return `Rework round ${formatCount(o.round)} of ${formatCount(o.max)}`;
    case 'needs-owner':
      return 'Needs you';
    case 'merged':
      return o.branch === null ? 'Merged' : `Merged into ${o.branch}`;
    case 'discarded':
      return 'Discarded';
    case 'no-changes':
      return 'No changes';
  }
}

export const REVIEW_LOOP_COPY = {
  modes: {
    word: MODE_WORDS,
    /** The radio label; the recommended mode says so. */
    label: {
      manual: 'Manual',
      'auto-edits': 'Auto edits (recommended)',
      auto: 'Auto',
      'full-auto': 'Full auto',
    } satisfies Record<ApprovalMode, string>,
    /** One plain sentence: what runs without asking. */
    hint: {
      manual:
        'Nothing runs without asking: every edit and every command waits for you, harness checks too.',
      'auto-edits':
        'Edits inside the helper’s own copy and the project’s exact harness checks run without asking. Everything else asks.',
      auto: 'Like Auto edits, plus the commands you allow below. Everything else asks.',
      'full-auto':
        'Nothing asks you during the run: the plan is approved automatically, and helpers work in Claude Code’s auto mode with commands in the operating-system sandbox. You review everything once, in the final merge.',
    } satisfies Record<ApprovalMode, string>,
  },
  approvals: {
    title: 'Approvals',
    note: 'What helpers and the tester may do without asking you: the default for each new run. You can change it when you start a ticket.',
    legend: 'Approval mode',
    warningTitle: 'Agent-written code can run without asking',
    warning:
      'Under Auto edits and Auto, a harness check or an allowed command runs code the agents wrote (tests, build scripts) with your user’s permissions on this computer. Choose Manual to see every command first.',
    commandsTitle: 'Allowed commands',
    commandsNote: (max: number) =>
      `Auto runs these without asking when a command matches one word for word. At most ${max}.`,
    commandsKept: 'Kept for Auto mode; not used in this mode.',
    commandsEmpty:
      'No commands yet. Without any, Auto behaves like Auto edits: only edits and harness checks run without asking.',
    commandLabel: 'Command',
    commandHint: 'Words separated by spaces, for example npm test or mvn -q verify.',
    commandPlaceholder: 'npm test',
    matchLabel: 'How it matches',
    match: {
      exact: 'Exactly these words',
      prefix: 'Plus any arguments',
    },
    matchTag: {
      exact: 'Exact',
      prefix: '+ any arguments',
    },
    add: 'Add command',
    remove: (command: string) => `Remove ${command}`,
    listLabel: 'Allowed commands',
    errors: {
      empty: 'Type a command first.',
      tooMany: (max: number) => `At most ${max} commands. Remove one first.`,
      tooManyWords: (max: number) => `Use at most ${max} words.`,
      duplicate: 'This command is already in the list.',
      characters: (token: string) =>
        `“${token}” can’t be used: only letters, digits and . _ / : = @ + % , - are allowed, so a command can never chain, redirect or expand anything.`,
      path: (token: string) =>
        `“${token}” can’t be used: no absolute paths and no “..”, so a command stays inside the project.`,
    },
    /** Settings: the read-only summary. */
    summary: (mode: string) => `Approvals: ${mode}.`,
    summaryCommands: (n: number) => `${countOf(n, 'allowed command', 'allowed commands')}.`,
    summaryLink: 'Change on Workflow',
  },
  wizard: {
    step: 'Approvals',
    title: 'Approvals',
    description:
      'How much helpers may do without asking you. You can change it later on the Workflow page, and for each run when you start it.',
    autoCommands: 'Add the commands Auto may run on the Workflow page after setup.',
  },
  review: {
    reviewerLegend: 'Who reviews each change',
    reviewer: {
      agent: 'Review agent (recommended)',
      lead: 'The lead',
    } satisfies Record<ChangeReviewerMode, string>,
    reviewerHint: {
      agent:
        'A read-only review agent reads each helper’s change and posts its findings; the lead then decides.',
      lead: 'The lead reads each change itself and decides. No extra agent runs.',
    } satisfies Record<ChangeReviewerMode, string>,
    reviewerWord: {
      agent: 'Review agent',
      lead: 'Lead',
    } satisfies Record<ChangeReviewerMode, string>,
    rounds: 'Rework rounds',
    roundsHint:
      'How often the lead may send one change back to its helper. You can allow more on the ticket page.',
    roundsValue: (n: number) =>
      n === 0 ? 'No rework: merge or discard' : countOf(n, 'rework round', 'rework rounds'),
    agentTitle: 'Review agent',
    agentNote: 'The agent that reviews each change: its agent file, model and skill.',
    leadNote: 'The lead reviews the changes itself, so no review agent runs.',
    /** The Workflow graph's review node. */
    who: {
      agent: 'Review agent + lead',
      lead: 'Lead + harness checks',
    } satisfies Record<ChangeReviewerMode, string>,
    leadMerges: 'The lead merges each change',
    roundsLine: (n: number) =>
      n === 0 ? 'No rework rounds' : `Up to ${countOf(n, 'rework round', 'rework rounds')}`,
    stageText:
      'Each helper’s change is reviewed, then the lead merges it into the ticket branch, sends it back for rework or discards it. Required harness checks must pass first. At the end you merge the ticket branch into its target once, or open a pull request.',
    errorTitle: 'Review agent',
  },
  graph: {
    rework: (n: number) => (n > 0 ? `Rework ×${formatCount(n)}` : 'Rework'),
    /** The Workflow page's rework edge: the limit, not a count. */
    reworkUpTo: (n: number) =>
      n > 0 ? `Rework, up to ${formatCount(n)}×` : 'Rework, only if you allow it',
    ownerMerge: {
      who: 'You',
      title: 'Finish',
      text: 'Merge or open a pull request, once, for the whole ticket.',
      tip: 'Every merged change lands on the ticket branch. At the end you merge that branch into its target once, or push it and open a pull request, or ask for changes.',
    },
    counts: {
      waiting: (n: number) => `${formatCount(n)} waiting`,
      inReview: (n: number) => `${formatCount(n)} in review`,
      rework: (n: number) => `${formatCount(n)} in rework`,
      needsOwner: (n: number) => `${formatCount(n)} for you`,
      merged: (n: number) => `${formatCount(n)} merged`,
      discarded: (n: number) => `${formatCount(n)} discarded`,
      noChanges: (n: number) => `${formatCount(n)} without changes`,
      none: 'No changes yet',
    },
    helpersWaiting: (n: number) => `${formatCount(n)} in review`,
  },
  start: {
    options: 'Start with options…',
    optionsFor: (key: string) => `Start ${key} with options`,
    rerunOptionsFor: (key: string) => `Re-run ${key} with options`,
    optionsShort: 'Options',
    title: (key: string) => `Start ${key}`,
    rerunTitle: (key: string) => `Re-run ${key}`,
    description:
      'Choose how this run works. Each choice starts at the project’s setting and applies to this run only.',
    projectDefault: 'Project setting',
    projectRounds: (n: number) => `Project setting: ${formatCount(n)}.`,
    mode: 'Approvals for this run',
    reviewer: 'Who reviews each change',
    rounds: 'Rework rounds',
    submit: 'Start',
    rerunSubmit: 'Re-run',
    starting: 'Starting…',
    failed: 'The run didn’t start.',
    cancel: 'Cancel',
    loading: 'Loading the project’s settings…',
    loadFailed:
      'The project’s settings couldn’t be loaded, so this run would use them as they are.',
    unchanged: 'Same as the project’s settings.',
    changed: (n: number) =>
      `${countOf(n, 'choice differs', 'choices differ')} from the project, for this run only.`,
  },
  changes: {
    cardLabel: (role: string) => `Change by ${role}`,
    stateTip: {
      sealing: 'Its work is being saved as one commit for review.',
      ready: 'Its change is saved and waits for a reviewer.',
      reviewing: 'A reviewer is reading the change.',
      decision: 'The review is in. The lead decides: merge, rework or discard.',
      rework: 'Sent back to its helper with what should change.',
      'needs-owner': 'The lead asked you, or ended before deciding. You decide below.',
      merged: 'Merged into the ticket branch. You merge that branch into main at the end.',
      discarded: 'Its change was dropped; none of it reaches the ticket branch.',
      'no-changes': 'It finished without changing any file.',
    } satisfies Record<ChangeState, string>,
    files: (n: number | null) =>
      n === null ? 'Files not reported' : countOf(n, 'changed file', 'changed files'),
    checks: {
      none: 'No checks on this commit yet',
      stopped: 'Checks stopped when the app stopped; they run again',
      passed: (passed: number, total: number) =>
        `${formatCount(passed)} of ${formatCount(total)} checks passed`,
      failed: (n: number) => `${countOf(n, 'required check', 'required checks')} failed`,
    },
    conflicts: (branch: string) => `Conflicts with ${branch} in:`,
    conflictsShort: 'Conflicts',
    branchFallback: 'the ticket branch',
    conflictsNote: 'The helper must update its change before it can be merged.',
    history: 'Decisions',
    historyEmpty: 'No review yet.',
    round: (n: number) => `Round ${formatCount(n + 1)}`,
    reviewer: {
      agent: 'Review agent',
      lead: 'Lead',
      owner: 'You',
    } satisfies Record<ChangeReviewerKind, string>,
    verdict: {
      approve: 'approved it',
      rework: 'asked for rework',
    } satisfies Record<ChangeVerdict, string>,
    reviewing: 'reviewing…',
    decision: {
      merge: 'merged it',
      'merge-anyway': 'merged it anyway',
      rework: 'sent it back for rework',
      discard: 'discarded it',
      'ask-owner': 'asked you to decide',
    } satisfies Record<ChangeDecision, string>,
    decider: {
      lead: 'Lead',
      owner: 'You',
      reviewer: 'Review agent',
    } satisfies Record<ChangeDecider, string>,
    commentGone: 'The comment is no longer on the ticket.',
    owner: {
      title: 'Your decision',
      leadEnded: 'The lead has ended, so you decide what happens to this change.',
      asked: 'The lead asked you to decide.',
      merge: (branch: string) => `Merge into ${branch}`,
      confirmMerge: (role: string, branch: string) =>
        `Merge the ${role}’s change into ${branch}? The required checks must have passed on it.`,
      confirmMergeButton: 'Merge',
      rework: 'Send back for rework…',
      reworkTitle: 'What should the helper change?',
      reworkHint: 'Required. Your note goes to the helper and is kept as a ticket comment.',
      reworkPlaceholder: 'For example: keep the old API working and add a test for the new option.',
      reworkTooLong: (max: number) => `Keep it under ${formatCount(max)} characters.`,
      reworkExtra: (used: number, max: number) =>
        `It has used ${formatCount(used)} of ${countOf(max, 'rework round', 'rework rounds')}; yours can go past the limit.`,
      sendRework: 'Send back',
      discard: 'Discard',
      confirmDiscard: (role: string) =>
        `Discard the ${role}’s change? None of it reaches the ticket branch. This can’t be undone.`,
      confirmDiscardButton: 'Discard change',
      cancel: 'Cancel',
      working: 'Working…',
      failed: 'That didn’t work.',
    },
    needsYou: {
      title: (n: number) => `${countOf(n, 'change needs', 'changes need')} your decision`,
      description: 'The lead asked you, or ended before deciding. Open a change to decide.',
      open: 'Open',
    },
    allTitle: 'Changes in this run',
    none: 'No helper has finished a change yet.',
    stillWorking: 'Its change shows here once it finishes its turn.',
  },
  branch: {
    title: 'Ticket branch',
    tip: 'Every change the lead merges lands on this branch, never on its target (main, for example). At the end you merge the branch into the target once, as a clean fast-forward, or push it and open a pull request on GitHub. The target changes only on your click.',
    description:
      'Every merged change lands here. At the end you merge it once, or open a pull request.',
    state: {
      open: 'Open',
      merged: 'Merged',
      discarded: 'Discarded',
    } satisfies Record<TicketBranchState, string>,
    mergedInto: (base: string) => `Merged into ${base}`,
    mergedAt: (base: string) => `${base} is now at`,
    base: 'Based on',
    tipCommit: 'Tip',
    changesMerged: (n: number) => countOf(n, 'change merged', 'changes merged'),
    waiting:
      'The agents are still working. You can merge once every change is decided and the last stage has run.',
    loading: 'Loading the combined change…',
    loadFailed: 'The combined change couldn’t be loaded.',
    files: (n: number) => countOf(n, 'changed file', 'changed files'),
    noFiles: 'No files changed on the ticket branch.',
    diff: 'The combined change, line by line',
    checksTitle: 'Checks on the tip',
    checksNone: 'No checks have run on the tip yet.',
    checksStopped:
      'The app stopped before the checks on the tip finished. They run again when you merge.',
    blocked: (names: string) =>
      `A required check failed on the tip (${names}). Ask for changes, or merge anyway with a reason.`,
    baseMoved: (base: string) =>
      `${base} moved since this branch started, so it no longer merges as a fast-forward. Update it from ${base} first; the checks run again.`,
    merge: (base: string) => `Merge into ${base}`,
    confirmMerge: (branch: string, base: string) =>
      `Merge ${branch} into ${base}? ${base} moves forward to the ticket branch and the ticket is done. Your project folder must be on ${base} with no uncommitted changes.`,
    confirmMergeButton: 'Merge',
    mergeAnyway: 'Merge anyway…',
    mergeAnywayTitle: 'Merge although a required check failed',
    reasonLabel: 'Why merge anyway?',
    reasonHint: 'Required. It is kept with the run.',
    reasonPlaceholder: 'For example: the flaky e2e check fails on main too.',
    reasonTooLong: (max: number) => `Keep the reason under ${formatCount(max)} characters.`,
    confirmMergeAnyway: 'Merge anyway',
    requestChanges: 'Request changes…',
    requestTitle: 'What should change?',
    requestHint: 'Required. The lead gets your comment and the run continues.',
    requestPlaceholder: 'For example: keep the old layout of the settings page on small screens.',
    requestTooLong: (max: number) => `Keep it under ${formatCount(max)} characters.`,
    sendRequest: 'Send to the lead',
    discard: 'Discard branch',
    confirmDiscard: (branch: string) =>
      `Discard ${branch}? The branch and every change merged into it are deleted. This can’t be undone.`,
    confirmDiscardButton: 'Discard branch',
    discardOnly: 'This run has stopped. Its ticket branch can only be discarded.',
    update: (base: string) => `Update from ${base}`,
    cancel: 'Cancel',
    working: 'Working…',
    failed: 'That didn’t work.',
  },
  /** The run's approval mode, in the summary under the ticket header. */
  runMode: (mode: string) => `Approvals: ${mode}`,
  /** An approval an allow rule decided (ADR-0021), in the request history. */
  autoApproved: {
    'edit-in-own-worktree': 'Approved automatically: edit in its own copy',
    'run-harness-check': 'Approved automatically: harness check',
    'command-allowlist': 'Approved automatically: allowed command',
  } satisfies Record<AllowRule, string>,
  /** Full auto (ADR-0022, RL-G). */
  fullAuto: {
    warningTitle: 'Full auto: you review everything once, at the end',
    warning:
      'Claude Code’s auto mode reviews risky actions with a second model and commands run in the operating-system sandbox; it can still make mistakes — you review everything once in the final merge.',
    approvalsNote:
      'Full auto: Claude Code’s auto mode decides each helper action in this run, and nothing waits for you. Its decisions are not listed here; you review the whole result once, at the final merge.',
    planApproved: 'Approved automatically (Full auto)',
  },
} as const;

// --- Live run graph and run options as a limit (WG-E, wp/wg-e-live; ADR-0023) --------------------
//
// Add-only. The ticket page's live graph of the run's own workflow, the run options read as a
// limit ("at most"), the change cards' direct rework by the review agent, and "Used by" blocks on
// Skills & Agents. Plain owner words: blocks and links, never nodes, edges or engines.

/** What a block is called by its kind on the live graph; a reviewer's word depends on its scope. */
type LiveBlockKind =
  | 'planner'
  | 'lead'
  | 'helper-pool'
  | 'helper'
  | 'reviewer-change'
  | 'reviewer-final'
  | 'tester'
  | 'ticket'
  | 'plan-approval'
  | 'checks'
  | 'ticket-merge'
  | 'owner-merge'
  | 'done';

export const WORKFLOW_LIVE_COPY = {
  graph: {
    description: 'Where this run is: each block of the workflow it started with, live.',
    tip: 'The blocks and links are this run’s workflow as it was when the run started, with the models, skills and approval modes it runs with. Click a block, or an agent on it, to show that agent in the side panel.',
    label: 'This run’s workflow',
    kinds: {
      planner: 'Planner',
      lead: 'Lead',
      'helper-pool': 'Helper pool',
      helper: 'Named helper',
      'reviewer-change': 'Change reviewer',
      'reviewer-final': 'Final reviewer',
      tester: 'Tester',
      ticket: 'Ticket',
      'plan-approval': 'You',
      checks: 'Checks',
      'ticket-merge': 'Ticket branch',
      'owner-merge': 'You',
      done: 'Done',
    } satisfies Record<LiveBlockKind, string>,
    gateTitle: {
      'plan-approval': 'Approve the plan',
      'owner-merge': 'Finish',
    },
    planAuto: 'Approved automatically',
    planAsks: 'You approve the plan',
    readOnly: 'Read-only',
    ownCopy: 'Own copy',
    model: 'Model',
    projectModel: 'Project default',
    fileOrProjectModel: 'Agent file’s or project default',
    noSkills: 'No skills',
    mode: (mode: string) => `Mode: ${mode}`,
    modeTip:
      'The approval mode this block runs with in this run. A ticket or run setting can only make it more careful.',
    sandboxed: 'Sandboxed',
    sandboxTip:
      'This block is set to Full auto, so its commands run in the operating-system sandbox, also when this run is more careful.',
    direct: 'Sends changes back to the helper itself',
    directTip:
      'This review agent sends each change it reviews straight back to its helper for rework, telling the lead each round. Approved changes, or changes out of rounds, go to the lead, who merges.',
    agentsLabel: (block: string) => `Agents of ${block}`,
    agentsMore: (n: number) => `+${formatCount(n)}`,
    agentsMoreTip: (n: number) =>
      `${countOf(n, 'more agent', 'more agents')}. Click the block to show the one working now, or see them all under Agents.`,
    selectAgent: (role: string) => `Show the ${role} in the side panel`,
    rework: (n: number) => (n > 0 ? `Rework ×${formatCount(n)}` : 'Rework'),
    directRework: (n: number) => (n > 0 ? `Direct rework ×${formatCount(n)}` : 'Direct rework'),
    links: {
      flow: 'Next step',
      assigns: 'Assigns work',
      review: 'Sends its change for review',
      findings: 'Sends its findings',
      rework: 'Sends the change back for rework',
      merge: 'Merges through',
    },
    linkName: (kind: string, from: string, to: string) => `${kind}: from ${from} to ${to}`,
    changes: 'Changes',
  },
  ceiling: {
    /** The Start dialog's and the ticket's mode choice: a limit, never a loosening. */
    legend: 'Approval mode: at most',
    /** The ticket's Run options row. */
    rowLabel: 'Approvals, at most',
    noLimit: 'No limit',
    noLimitHint: (projectMode: string) =>
      `Each block runs with the mode set on the Workflow page. Blocks set to Project default use ${projectMode}.`,
    noLimitOption: 'No limit: each block’s own mode',
    summary: (mode: string) =>
      `Approval mode: at most ${mode} — blocks set to a stricter mode keep it; this can’t loosen any block.`,
    summaryNone: 'Approval mode: no limit — each block keeps the mode set on the Workflow page.',
    noEffect: (mode: string, loosest: string) =>
      `No block in this workflow is set looser than ${loosest}, so “at most ${mode}” changes nothing.`,
    noEffectTicket: (mode: string, ticket: string) =>
      `This ticket is limited to at most ${ticket}, so “at most ${mode}” changes nothing for this run.`,
    ticketHint:
      'A limit for this ticket’s runs: blocks set to a stricter mode keep it, and it can’t loosen any block.',
    reviewerHint: {
      agent: 'Each change follows the workflow’s review links.',
      lead: 'Lead reviews: every change goes to the lead for this run, whatever the workflow’s review links say.',
    },
    ticketReviewerHint:
      'Lead reviews sends every change to the lead on this ticket’s runs, whatever the workflow’s review links say. Review agent follows the workflow.',
    roundsHint:
      'Replaces every rework limit in the workflow for this run. Unchanged, each rework link keeps its own limit.',
    ticketRoundsHint:
      'Replaces every rework limit in the workflow on this ticket’s runs. Project default keeps each rework link’s own limit.',
  },
  changes: {
    /** A round the review agent sent straight back to the helper (review route "direct"). */
    directRework: 'Review agent sent it back to the helper for rework',
    directRounds: (reviewer: number, lead: number) =>
      [
        `Review agent: ${countOf(reviewer, 'direct rework round', 'direct rework rounds')}`,
        ...(lead > 0 ? [`lead: ${countOf(lead, 'rework round', 'rework rounds')}`] : []),
      ].join(' · '),
    directRoundsTip:
      'In this workflow the review agent sends changes back to the helper itself, and the lead merges once the review agent approves (or its rounds run out).',
    directBadge: (n: number) => `Direct rework ×${formatCount(n)}`,
  },
  usedBy: {
    /** "Used by" names the workflow's blocks once the server sends them. */
    inUse: (blocks: string) =>
      `Used by ${blocks}. Remove it from those blocks on the Workflow page before deleting it.`,
    openBlock: (block: string) => `Open ${block} on the Workflow page`,
  },
} as const;

/** "Frontend helper, Helpers and Change reviewer": block labels in a sentence. */
export function blockList(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1] ?? ''}`;
}

/**
 * A ticket's own run options (RL-H): the New ticket dialog, the ticket page's Run options, the
 * board card's badge and the Start dialog's markers. "Project default" follows the project's
 * settings, also when they change later.
 */
export const TICKET_OPTIONS_COPY = {
  mode: 'Approvals',
  modeHint:
    'How much helpers may do without asking you on this ticket’s runs. Project default follows the project, also when it changes.',
  reviewer: 'Who reviews each change',
  rounds: 'Rework rounds',
  more: 'More options',
  /** The select's first option: "Project default (Full auto)", or without the value while unknown. */
  projectDefault: (value: string | null) =>
    value === null ? 'Project default' : `Project default (${value})`,
  roundsValue: (n: number) => (n === 0 ? 'No rework' : countOf(n, 'rework round', 'rework rounds')),
  section: {
    title: 'Run options',
    note: 'Each new run of this ticket starts with these. A run already started keeps its own.',
    edit: 'Change',
    editLabel: 'Change run options',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    failed: 'The run options weren’t saved.',
    own: 'This ticket',
  },
  badge: {
    /** The card chip's spoken label and tooltip. */
    label: (parts: string) => `This ticket’s own run options: ${parts}`,
    reviewer: {
      agent: 'Review agent',
      lead: 'Lead reviews',
    } satisfies Record<ChangeReviewerMode, string>,
  },
  start: {
    ticketSetting: 'This ticket',
    ticketRounds: (n: number) => `This ticket: ${formatCount(n)}.`,
    description:
      'Choose how this run works. Each choice starts at this ticket’s setting (or the project’s) and applies to this run only.',
    unchanged: 'Same as this ticket’s settings.',
    changed: (n: number) =>
      `${countOf(n, 'choice differs', 'choices differ')} from this ticket’s settings, for this run only.`,
  },
} as const;

// --- Branching strategies and GitHub (G-B, wp/g-b-web; ADR-0025) --------------------------------
//
// Add-only. Project settings' Branches and GitHub cards, a ticket's own branch and target, and the
// ticket branch card's final step (merge here, or Push & open PR). Plain owner words: the GitHub
// CLI is named because the owner installs it; tokens, refs and remotes are not.

import type { BranchStrategyPreset } from '@acp/core';
import type { PullRequestState } from '@acp/core/api';

/** A project's choice in Settings: a preset, or no strategy (the `acp/<KEY>` behaviour). */
export type BranchingChoiceKey = BranchStrategyPreset | 'none';

/** Why the app can't reach GitHub for a project, in the order the owner should fix it. */
export type CodeHostProblemKey = 'no-remote' | 'no-cli' | 'not-logged-in';

/** The server's error codes for Push & open PR and Refresh (ADR-0025). */
export type PullRequestErrorCode =
  | 'gh-not-installed'
  | 'gh-not-logged-in'
  | 'no-github-remote'
  | 'push-rejected'
  | 'pr-exists-elsewhere'
  | 'timeout'
  | 'gh-failed';

export const BRANCHING_COPY = {
  card: {
    title: 'Branches',
    description: 'How ticket branches are named, where they start and where the work goes back.',
    tip: 'Each ticket’s work happens on its own branch, created when you approve the plan: from the branch you choose to start from, or from its target branch. A change here applies to plans you approve from now on.',
  },
  choiceLabel: 'Branching strategy',
  choices: {
    'github-flow': {
      word: 'GitHub flow',
      text: 'Tickets branch from your main branch and go back to it, usually through a pull request.',
    },
    'git-flow': {
      word: 'Git flow',
      text: 'Tickets branch from develop and go back to develop. Releases are made from develop.',
    },
    custom: {
      word: 'Custom',
      text: 'Your own branches and your own branch names.',
    },
    none: {
      word: 'None, keep acp/<KEY>',
      text: 'As before: each ticket branches from the branch your project folder is on.',
    },
  } satisfies Record<BranchingChoiceKey, { word: string; text: string }>,
  noneNote: (key: string) =>
    `Ticket branches are named like acp/${key}-12. They start from the branch your project folder is on, and you merge them back into it.`,
  baseBranch: 'Base branch',
  baseBranchHint: 'The long-lived branch new work starts from, for example main or develop.',
  targetBranch: 'Default target branch',
  targetBranchHint:
    'Where a ticket’s work is merged, or its pull request opened, unless the ticket says otherwise.',
  /** ADR-0025 §10 (G-H): where new ticket branches start. */
  sourceBranch: 'Start ticket branches from',
  sourceBranchHint:
    'New ticket branches start at the latest commit of this branch, unless the ticket says otherwise. The work still goes back to the target branch.',
  sourceSameAsTarget: 'Same as the target branch',
  /** "Same as the target branch (dev)". */
  sourceSameAsTargetNamed: (target: string) => `Same as the target branch (${target})`,
  /** A saved start branch the project folder doesn't list (still offered, with a warning). */
  sourceNotListed: (name: string) => `${name} (not in the project folder)`,
  template: 'Ticket branch name',
  templateHint:
    'Use {key} for the ticket number (required), {slug} for words from its title and {type} for its type’s word.',
  locked: 'Set by the strategy. Choose Custom to change it.',
  typeWords: 'Word for each ticket type',
  typeWordsHint: 'What {type} becomes in a branch name.',
  preview: 'Preview',
  previewTip: 'Names for two example tickets. A name already taken gets -r1, -r2 and so on.',
  previewUnavailable: 'Fix the name above to see a preview.',
  /** The example tickets of the preview. */
  sample: { feature: 'Add saved searches', bug: 'Login fails on Safari' },
  errors: {
    branch: 'Use letters, digits, “.”, “_”, “-” and “/”, for example main or release/2.0.',
    branchMissing: 'Enter a branch name.',
    templateMissing: 'Enter a name, for example {type}/{key}-{slug}.',
    templateTooLong: 'Keep it under 120 characters.',
    templateToken: (tokens: string) => `Only {key}, {slug} and {type} work here, not ${tokens}.`,
    templateNeedsKey: 'Include {key}, so every ticket gets its own branch.',
    templateInvalid:
      'This doesn’t give a valid branch name. Around the tokens, use letters, digits, “.”, “_”, “-” and “/”.',
    typeWord: 'Lowercase letters, digits and “-”, starting with a letter (up to 20).',
  },
  /** The new-project wizard's collapsed section. */
  wizardSummary: 'Branching strategy (optional)',
} as const;

export const CODE_HOST_COPY = {
  title: 'GitHub',
  description: 'Push a ticket’s branch and open a pull request from the ticket.',
  tip: 'The app uses your own GitHub CLI login (gh) and the project’s origin remote. It never stores a token, and it pushes or opens a pull request only when you click.',
  checking: 'Checking GitHub…',
  connected: (repo: string) => `Connected to GitHub: ${repo}`,
  word: { connected: 'Connected', notConnected: 'Not connected' },
  defaultBranch: 'Default branch on GitHub',
  problems: {
    'no-remote':
      'This project has no GitHub remote. Add one named origin with the repository’s address, then check again.',
    'no-cli':
      'The GitHub CLI isn’t installed. Install the GitHub CLI (gh) and run gh auth login, then check again.',
    'not-logged-in':
      'The GitHub CLI isn’t signed in. Run gh auth login in a terminal, then check again.',
  } satisfies Record<CodeHostProblemKey, string>,
  recheck: 'Check again',
  rechecking: 'Checking…',
  loadFailed: 'GitHub couldn’t be checked.',
} as const;

/** The refusals of connecting a project from Settings (G-E), worded by the web. */
export type CodeHostConnectErrorCode =
  | 'origin_exists'
  | 'code_host_not_ready'
  | 'invalid_repository'
  | 'repository_create_failed'
  | 'not_a_git_repository'
  | 'invalid_request'
  | 'gh-failed';

/** G-E (ADR-0025 §7): connecting a project to GitHub from its Settings card. */
export const CODE_HOST_CONNECT_COPY = {
  /** Connected: "Connected to GitHub:" then the `owner/name` link. */
  connectedLead: 'Connected to GitHub:',
  newTab: '(opens in a new tab)',
  install: {
    message:
      'The GitHub CLI (gh) isn’t installed. The app uses it to create repositories and open pull requests with your own GitHub login.',
    brew: 'On a Mac with Homebrew, run this in a terminal:',
    command: 'brew install gh',
    other: 'On other systems, follow the steps at',
    site: 'cli.github.com',
    siteUrl: 'https://cli.github.com',
    then: 'Then sign in with gh auth login, and check again.',
  },
  login: {
    message: 'The GitHub CLI isn’t signed in.',
    run: 'Run this in a terminal:',
    command: 'gh auth login',
    why: 'You sign in to GitHub yourself, in the terminal: the app never handles your GitHub credentials.',
    then: 'When it says you’re logged in, check again.',
  },
  copyCommand: 'command',
  connect: {
    message:
      'This project isn’t on GitHub yet. Create a repository for it, or connect one you already have.',
    choose: 'How to connect',
    create: 'Create a new repository',
    existing: 'Connect an existing repository',
  },
  create: {
    name: 'Repository name',
    nameHint: 'Letters, digits, dots, dashes and underscores.',
    owner: 'Owner',
    ownerPlaceholder: 'Your account',
    ownerHint: 'Leave empty for your own account, or enter an organization you belong to.',
    visibility: 'Visibility',
    private: 'Private',
    privateHint: 'Only you and the people you add can see it.',
    public: 'Public',
    publicHint: 'Anyone on the internet can see it.',
    push: 'Push the current branch now',
    /** G-F: the same, once the project's branches say which branch it is. */
    pushNamed: (branch: string) => `Push ${branch} now`,
    pushHint:
      'Sends the branch the project folder is on, so GitHub has your code. A branch without commits is not pushed.',
    /** "Creates github.com/you/web-app as a private repository and sets it as origin." */
    summary: (
      owner: string | null,
      name: string,
      visibility: 'private' | 'public',
      push: boolean,
      /** G-F: the branch that is pushed, when known. */
      branch?: string | null,
    ) =>
      `Creates github.com/${owner ?? 'you'}/${name} as a ${visibility} repository and sets it as origin${push ? `, then pushes ${branch ?? 'the current branch'}` : ''}.`,
    button: 'Create repository',
    busy: 'Creating…',
    errors: {
      nameMissing: 'Enter a name.',
      name: 'Use letters, digits, dots, dashes and underscores, up to 100. Not “.”, “..” or a name ending in .git.',
      owner: 'Use the account or organization name: letters, digits and single dashes, up to 39.',
    },
  },
  existing: {
    label: 'Repository',
    hint: 'owner/name, or its GitHub address.',
    placeholder: 'owner/name or https://github.com/owner/name',
    /** "Connects github.com/acme/widgets as origin, over HTTPS." */
    summary: (owner: string, name: string, protocol: 'https' | 'ssh') =>
      `Connects github.com/${owner}/${name} as origin, over ${protocol === 'ssh' ? 'SSH' : 'HTTPS'}. Nothing is pushed.`,
    invalid: 'Use owner/name, https://github.com/owner/name or git@github.com:owner/name.git.',
    button: 'Connect',
    busy: 'Connecting…',
  },
  errors: {
    origin_exists:
      'This project already has a remote named origin, so nothing was changed. Check again to see it.',
    code_host_not_ready:
      'The GitHub CLI isn’t ready: it’s missing or not signed in. Check again for the steps.',
    invalid_repository:
      'That isn’t a GitHub repository. Use owner/name, https://github.com/owner/name or git@github.com:owner/name.git.',
    repository_create_failed:
      'GitHub refused to create the repository: it may already exist, or the name is not allowed.',
    not_a_git_repository: 'The project folder isn’t a git repository, so it can’t have an origin.',
    invalid_request: 'The app couldn’t send that. Check the fields, then try again.',
    'gh-failed':
      'The GitHub CLI reported a problem. Try again; if it keeps failing, run gh auth status in a terminal.',
  } satisfies Record<CodeHostConnectErrorCode, string>,
  failed: 'That didn’t work.',
  done: 'Connected. GitHub is set up for this project.',
} as const;

export const TICKET_BRANCH_COPY = {
  title: 'Branch',
  note: 'Where this ticket’s work goes. Empty fields follow the project.',
  name: 'Branch name',
  nameHint: 'Leave empty for the name the project gives.',
  target: 'Target branch',
  targetHint: 'Where the work is merged or the pull request goes. Leave empty for the project’s.',
  /** "Project default (feature/WEB-12-add-saved-searches)". */
  projectDefault: (value: string | null) =>
    value === null ? 'Project default' : `Project default (${value})`,
  /** The target without a strategy: the branch the project folder is on. */
  currentBranch: 'the project folder’s branch',
  own: 'This ticket',
  edit: 'Change',
  editLabel: 'Change the branch settings',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  failed: 'The branch settings weren’t saved.',
  /** Once the run has created the branch. */
  created: 'The run created this branch. Its name and target stay as they are for this run.',
  actualBranch: 'Name',
  actualTarget: 'Target',
  /** ADR-0025 §10 (G-H): the branch the ticket's branch starts from. */
  from: 'Start from',
  fromHint: 'The branch this ticket’s branch starts from. Leave empty for the project’s.',
  /** What an empty "Start from" follows when the project names no start branch. */
  fromTarget: 'the target branch',
  actualFrom: 'Started from',
  fromListLabel: 'Local branches',
} as const;

/** The refusals of creating a branch (G-F), worded by the web. */
export type ProjectBranchErrorCode =
  | 'branch_exists'
  | 'base_branch_missing'
  | 'no_origin'
  | 'invalid_branch_name'
  | 'not_a_git_repository'
  | 'code_host_unavailable'
  | 'invalid_request';

/** G-F (ADR-0025 §8): a project's local branches, and creating one on the owner's click. */
export const PROJECT_BRANCHES_COPY = {
  card: {
    title: 'Local branches',
    description: 'The branches in the project folder. Create one here to use it as a target.',
    tip: 'Read from git when you open this page; the app doesn’t fetch. A new branch starts at the tip of the branch you pick. The project folder stays on its branch and no file changes.',
  },
  loading: 'Reading the branches…',
  loadFailed: 'The branches couldn’t be read.',
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  empty: 'This project has no branches yet. Make a first commit in the project folder.',
  /** "12 branches" over the list. */
  count: (n: number) => `${n} ${n === 1 ? 'branch' : 'branches'}`,
  truncated: 'Only the first 500 branches are shown.',
  listLabel: 'Local branches',
  current: 'Current',
  currentTip: 'The project folder is on this branch.',
  onOrigin: (github: boolean) => (github ? 'On GitHub' : 'On origin'),
  onOriginTip: 'origin has a branch of this name (as of your last fetch).',
  commitLabel: (commit: string) => `Commit ${commit}`,
  newTitle: 'New branch',
  name: 'Name',
  nameHint: 'For example dev, release/2.0 or feature/search.',
  nameMissing: 'Enter a branch name.',
  nameExists: 'A branch with this name already exists.',
  from: 'From',
  fromHint: 'The new branch starts at this branch’s latest commit.',
  /** The push checkbox: "Also push to GitHub", or to origin when it isn't on GitHub. */
  push: (github: boolean) => (github ? 'Also push to GitHub' : 'Also push to origin'),
  pushHint: 'Sends the new branch to origin right after it is created.',
  create: 'Create branch',
  /** The one-click form: "Create dev from main". */
  createFrom: (name: string, from: string) => `Create ${name} from ${from}`,
  busy: 'Creating…',
  /** Read out once the branch exists. */
  created: (name: string, pushed: boolean) =>
    pushed ? `Created ${name} and pushed it to origin.` : `Created ${name}.`,
  noBase: 'There is no local branch to start from yet.',
  failed: 'The branch wasn’t created.',
  errors: {
    branch_exists: 'A branch with this name already exists, so nothing was changed.',
    base_branch_missing:
      'The branch to start from isn’t in the project folder any more. Refresh and pick another.',
    no_origin:
      'This project has no origin remote, so the branch can’t be pushed. Create it without pushing.',
    invalid_branch_name: 'Git doesn’t accept this name. Try a simpler one, for example dev.',
    not_a_git_repository: 'The project folder isn’t a git repository, so it has no branches.',
    code_host_unavailable: 'This server can’t read the project’s branches.',
    invalid_request: 'The app couldn’t send that. Check the name, then try again.',
  } satisfies Record<ProjectBranchErrorCode, string>,
  /** G-H: Start refused because the start branch is missing (`source_branch_missing`). */
  sourceMissing: (name: string) =>
    `${name}, which this ticket’s branch starts from, isn’t a branch in the project folder yet. Create it, and the ticket starts again.`,
  /** Start refused because the target is missing (`target_branch_missing`). */
  missing: {
    text: (target: string) =>
      `${target} isn’t a branch in the project folder yet. Create it, and the ticket starts again.`,
    exists: (target: string) => `${target} exists now.`,
    startAgain: 'Start again',
  },
  /** The strategy form's warning under a branch field. */
  strategyMissing: (name: string) => `${name} isn’t a branch in the project folder yet.`,
  createIt: 'Create it',
  /** The ticket's target field. */
  targetListLabel: 'Local branches',
  targetMissing: (name: string) => `${name} isn’t a branch in the project folder yet.`,
} as const;

export const PULL_REQUEST_COPY = {
  push: 'Push & open PR',
  confirm: (branch: string, target: string) =>
    `Push ${branch} to origin and open a pull request against ${target} on GitHub. The pull request description is this ticket’s run summary.`,
  titleLabel: 'Pull request title',
  titleMissing: 'Enter a title.',
  titleTooLong: 'Keep it under 200 characters.',
  draft: 'Open it as a draft',
  draftHint: 'GitHub doesn’t ask for reviews until you mark it ready.',
  confirmButton: 'Push & open PR',
  pushing: 'Pushing…',
  cancel: 'Cancel',
  /** Why Push & open PR can't be used now; the button stays, disabled, with this under it. */
  blocked: {
    checking: 'Checking GitHub…',
    'no-remote': 'Needs a GitHub remote: this project’s origin isn’t on GitHub.',
    'no-cli': 'Needs the GitHub CLI: install gh, then run gh auth login.',
    'not-logged-in': 'Needs you signed in to GitHub: run gh auth login in a terminal.',
    unknown: 'GitHub couldn’t be checked, so pushing is off. Check it in the project’s settings.',
  } satisfies Record<CodeHostProblemKey | 'checking' | 'unknown', string>,
  number: (n: number) => `Pull request #${n}`,
  newTab: '(opens in a new tab)',
  state: { open: 'Open', merged: 'Merged', closed: 'Closed' } satisfies Record<
    PullRequestState,
    string
  >,
  checked: 'Checked',
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  openNote: (target: string) =>
    `Merge it here with Merge pull request, or on GitHub and then press Refresh. The ticket is done once it is merged into ${target}.`,
  mergedNote: (target: string) => `Merged into ${target} on GitHub. The ticket is done.`,
  closedNote:
    'Closed on GitHub without merging. You can merge the branch here or open a new pull request.',
  mergedOnGitHub: (target: string) => `Merged into ${target} on GitHub`,
  errors: {
    'gh-not-installed':
      'The GitHub CLI isn’t installed. Install the GitHub CLI (gh) and run gh auth login, then try again.',
    'gh-not-logged-in':
      'The GitHub CLI isn’t signed in. Run gh auth login in a terminal, then try again.',
    'no-github-remote': 'This project has no GitHub remote named origin. Add it, then try again.',
    'push-rejected':
      'GitHub refused the push, usually because the branch there has commits this one doesn’t. Look at the branch on GitHub, then try again.',
    'pr-exists-elsewhere':
      'This branch already has a pull request on GitHub against another branch. Close it there, then try again.',
    timeout: 'GitHub didn’t answer in time. Check your internet connection, then try again.',
    'gh-failed':
      'The GitHub CLI reported a problem. Try again; if it keeps failing, run gh auth status in a terminal.',
  } satisfies Record<PullRequestErrorCode, string>,
  failed: 'That didn’t work.',
  refreshFailed: 'The pull request couldn’t be checked.',
  /** G-D: the ticket branch moved on since the last push while its pull request is open. */
  pushNew: 'Push new commits',
  confirmPushNew: (branch: string, n: number) =>
    `Push the new commits on ${branch} to the open pull request #${n}.`,
  pushNewRejected:
    'The branch on GitHub has commits the app doesn’t have; it won’t overwrite them.',
} as const;

// --- Merge pull request and Delete branch (G-G, ADR-0025 §9) -----------------------------------
//
// Add-only. GitHub's own words for the merge methods and the button, so the owner sees what they
// know from GitHub. Merge and delete happen only after the confirmation, which says exactly what.

export type MergeMethodKey = 'merge' | 'squash' | 'rebase';

/** Server codes of a merge or a delete, beyond the pull request's (PULL_REQUEST_COPY.errors). */
export type BranchActionErrorCode =
  | 'no_open_pull_request'
  | 'unpushed_commits'
  | 'code_host_not_ready'
  | 'merge_method_not_allowed'
  | 'pull_request_not_mergeable'
  | 'merge_failed'
  | 'branch_not_finished'
  | 'branch_checked_out'
  | 'branch_protected'
  | 'branch_delete_failed';

export const MERGE_PR_COPY = {
  methodLabel: 'Merge method',
  methods: {
    merge: 'Create a merge commit',
    squash: 'Squash and merge',
    rebase: 'Rebase and merge',
  } satisfies Record<MergeMethodKey, string>,
  /** The main button, as GitHub labels it for each method. */
  button: {
    merge: 'Merge pull request',
    squash: 'Squash and merge',
    rebase: 'Rebase and merge',
  } satisfies Record<MergeMethodKey, string>,
  confirmButton: {
    merge: 'Confirm merge',
    squash: 'Confirm squash and merge',
    rebase: 'Confirm rebase and merge',
  } satisfies Record<MergeMethodKey, string>,
  how: {
    merge: 'with a merge commit',
    squash: 'as one squashed commit',
    rebase: 'by rebasing its commits',
  } satisfies Record<MergeMethodKey, string>,
  deleteBranch: 'Delete branch',
  deleteBranchHint: 'On GitHub and in the project folder, once it is merged.',
  confirm: (n: number, target: string, how: string, branch: string, del: boolean) =>
    `Merges #${n} into ${target} on GitHub ${how}${
      del ? ` and deletes ${branch} there and in the project folder` : ''
    }. The ticket is done once GitHub reports it merged.`,
  merging: 'Merging…',
  cancel: 'Cancel',
  failed: 'The pull request wasn’t merged.',
  /** After a merge with Delete branch while the project folder is on the ticket branch. */
  keptLocal: (branch: string) =>
    `${branch} is still in the project folder: it’s checked out there, so the app left it. Switch to another branch, then use Delete branch.`,
  needsPush: 'Push the new commits first: GitHub would merge only what it has.',
  /** Delete branch, once the ticket branch is merged or discarded. */
  delete: 'Delete branch',
  deleteQuestion: (branch: string, where: 'both' | 'origin' | 'local', prOpen: number | null) =>
    `Deletes ${branch} ${
      where === 'both'
        ? 'on GitHub and in the project folder'
        : where === 'origin'
          ? 'on GitHub'
          : 'in the project folder'
    }.${prOpen !== null && where !== 'local' ? ` GitHub closes the open pull request #${prOpen}.` : ''} Its commits stay in the ticket’s history here.`,
  confirmDelete: 'Delete branch',
  deleting: 'Deleting…',
  deleted: 'Branch deleted',
  deleteFailed: 'The branch wasn’t deleted.',
  /** The muted fact in the ticket header once the branch is gone everywhere. */
  headerDeleted: 'branch deleted',
  errors: {
    no_open_pull_request:
      'There’s no open pull request to merge now. Press Refresh to see its state on GitHub.',
    unpushed_commits:
      'The ticket branch has commits the pull request doesn’t have yet. Push new commits first, then merge.',
    code_host_not_ready:
      'Merging needs the GitHub CLI installed and signed in. Run gh auth login in a terminal, then try again.',
    merge_method_not_allowed:
      'This repository doesn’t allow that merge method. Choose another one, or change it in the repository’s settings on GitHub.',
    pull_request_not_mergeable:
      'GitHub won’t merge it yet: it has conflicts, needs reviews or passing checks, is a draft or is closed.',
    merge_failed: 'GitHub didn’t merge it. Look at the pull request on GitHub, then try again.',
    branch_not_finished: 'The branch isn’t merged or discarded yet, so it can’t be deleted.',
    branch_checked_out:
      'The branch is checked out (in the project folder or another worktree). Switch to another branch first.',
    branch_protected: 'That’s the target or the project’s base branch; the app never deletes it.',
    branch_delete_failed:
      'Git couldn’t delete the branch. Check your access to the repository, then try again.',
  } satisfies Record<BranchActionErrorCode, string>,
} as const;

// --- The ticket badge: time taken and tokens (v0.3.0 T-A) ---------------------------------------
//
// Add-only. No cost: provider-reported costs are never added up (ADR-0014).

export const TICKET_TOTALS_COPY = {
  took: (d: string) => `Took ${d}`,
  running: (d: string) => `Running ${d}`,
  open: (d: string) => `Open for ${d}`,
  tokens: (n: string) => `${n} tokens`,
  noTokens: '—',
  unavailable: 'Usage unavailable',
  /** The badge's accessible name: the whole sentence. */
  label: (time: string, tokens: string) => `${time}, ${tokens}. Show details`,
  tokensSentence: (n: string) => `${n} tokens used`,
  tokensUnavailable: 'token usage unavailable',
  title: 'Time and tokens',
  started: 'Started',
  finished: 'Finished',
  notFinished: 'Not finished',
  elapsed: 'Time taken',
  elapsedSoFar: 'So far',
  runs: 'Runs',
  run: (n: number) => `Run ${n}`,
  live: 'running',
  tokenSplit: 'Tokens',
  input: 'Input',
  output: 'Output',
  cacheWrite: 'Cache write',
  cacheRead: 'Cache read',
  total: 'Total processed',
  partial: 'partial',
  partialTip: 'Some records didn’t report this, so the number is a lower bound.',
  openTokens: 'Open in Tokens',
  note: 'Direct usage of this ticket’s agent sessions, as on the Tokens page. No cost is added up.',
} as const;

// --- Workflow graph editor (WG-D, wp/wg-d-editor; ADR-0023) --------------------------------------
//
// Add-only. The Workflow page's editor (blocks, links, templates, problems) and the new-project
// wizard's template choice. Plain owner words: blocks and links, never nodes, edges or engines.

import type {
  AgentEffort,
  WorkflowEdgeType,
  WorkflowNodeType,
  WorkflowTemplateId,
} from '@acp/core';

/** The six blocks the owner can add from the palette. */
export type PaletteItemKey =
  'planner' | 'helper' | 'helper-pool' | 'change-reviewer' | 'final-reviewer' | 'tester';

/** What a block is called by its kind; a reviewer's word depends on its scope. */
type BlockKindKey = Exclude<WorkflowNodeType, 'reviewer'> | 'reviewer-change' | 'reviewer-final';

export const WORKFLOW_GRAPH_COPY = {
  description:
    'The agents that work on a ticket and how they connect. Add blocks, link them, save.',
  tip: 'Each block is an agent or a step. What a block may do is fixed by its kind: only helpers and the tester change files, each in its own copy of the project, and only the lead merges a change, after the checks you place before it. At the end you merge the ticket into its target branch or open a pull request. Ticket and run settings can only make an agent more careful, never less.',
  canvasTitle: 'How a ticket flows',
  canvasLabel: 'Workflow editor',
  canvasHint:
    'Drag a block to move it. Drag from a dot or the edge of a block onto another block to link them, or press Enter on a block’s dot and then on the other block; Shift+F10 lists the links a block can make. Drag the end of a selected link to move it. Select a block or link and press Delete to remove it. Command or Control+Z undoes, with Shift redoes.',
  loading: 'Loading the workflow…',
  kinds: {
    planner: 'Planner',
    lead: 'Lead',
    'helper-pool': 'Helper pool',
    helper: 'Named helper',
    'reviewer-change': 'Change reviewer',
    'reviewer-final': 'Final reviewer',
    tester: 'Tester',
    ticket: 'Ticket',
    'plan-approval': 'You',
    checks: 'Checks',
    'ticket-merge': 'Ticket branch',
    'owner-merge': 'You',
    done: 'Done',
  } satisfies Record<BlockKindKey, string>,
  kindText: {
    planner: 'Reads the ticket and the project and writes the plan. It never changes a file.',
    lead: 'Runs the ticket: starts helpers for the plan’s steps and merges each reviewed change into the ticket branch. It never changes a file itself.',
    'helper-pool':
      'Helpers the lead starts for any step no named helper takes, each in its own copy of the project.',
    helper:
      'A helper with its own name, for example “Frontend helper”. Plan steps can name it, and it works in its own copy of the project.',
    'reviewer-change':
      'Reads each change it is sent and passes its findings to the lead. It never changes a file.',
    'reviewer-final':
      'Reads the merged ticket branch at the end and posts its findings as ticket comments. It never changes a file.',
    tester:
      'Writes unit tests for the merged work in its own copy. Its change is reviewed like any other.',
    ticket: 'Where every ticket starts.',
    'plan-approval': 'You approve the plan before any helper starts, or ask for changes.',
    checks:
      'Runs the chosen checks on each change before the lead merges it into the ticket branch.',
    'ticket-merge': 'Every change is decided and the ticket branch holds the merged work.',
    'owner-merge':
      'You merge the ticket branch into its target or open a pull request, once, for the whole ticket.',
    done: 'The ticket is finished.',
  } satisfies Record<BlockKindKey, string>,
  gateTitle: {
    'plan-approval': 'Approve the plan',
    'owner-merge': 'Finish',
  },
  readOnly: 'Read-only',
  ownCopy: 'Own copy',
  model: 'Model',
  projectModel: 'Project default',
  projectModelNamed: (model: string) => `${model} (default)`,
  fileModel: (model: string) => `${model} (agent file)`,
  noSkills: 'No skills',
  skillMissing: (name: string) => `${name} (not in the project)`,
  agentMissing: (name: string) => `${name} (not found)`,
  modeBadge: (mode: string) => `Mode: ${mode}`,
  modeDefaultBadge: (mode: string | null) =>
    mode === null ? 'Mode: project default' : `Mode: ${mode} (default)`,
  instances: (n: number) => `Up to ${formatCount(n)} at once`,
  poolInstances: (n: number) => `Up to ${formatCount(n)} at once (project limit)`,
  planAuto: 'Approved automatically',
  planAsks: 'You approve each plan',
  blockProblems: (n: number) => countOf(n, 'problem'),
  blockWarnings: (n: number) => countOf(n, 'warning'),
  selectBlock: (label: string) => `Select ${label}`,
  palette: {
    label: 'Add a block',
    items: {
      planner: 'Planner',
      helper: 'Named helper',
      'helper-pool': 'Helper pool',
      'change-reviewer': 'Change reviewer',
      'final-reviewer': 'Final reviewer',
      tester: 'Tester',
    } satisfies Record<PaletteItemKey, string>,
    hints: {
      planner: 'A read-only planner writes the plan; the lead starts once you approve it.',
      helper: 'A helper with its own name, agent file, skills, model and approval mode.',
      'helper-pool': 'Generic helpers for any step no named helper takes.',
      'change-reviewer': 'Reads each change it is sent and passes its findings to the lead.',
      'final-reviewer': 'Reads the merged ticket branch at the end. Added just before your merge.',
      tester: 'Writes unit tests for the merged work. Added just before your merge.',
    } satisfies Record<PaletteItemKey, string>,
    add: (item: string) => `Add ${item}`,
    full: (item: string, max: number) =>
      max === 1
        ? `The workflow already has a ${item}; it can have only one.`
        : `The workflow already has ${formatCount(max)} of this block, the most it can have.`,
    tooManyBlocks: (max: number) =>
      `The workflow already has ${formatCount(max)} blocks, the most it can have.`,
  },
  newLabels: {
    planner: 'Planner',
    helper: (n: number) => `Helper ${formatCount(n)}`,
    'helper-pool': 'Helpers',
    'change-reviewer': 'Change reviewer',
    'final-reviewer': 'Code reviewer',
    tester: 'Tester',
  },
  edges: {
    flow: 'Next step',
    assigns: 'Assigns work',
    review: 'Sends its change for review',
    findings: 'Sends its findings',
    rework: 'Sends the change back for rework',
    merge: 'Merges through',
  } satisfies Record<WorkflowEdgeType, string>,
  edgeText: {
    flow: 'The order of the steps: the plan, then after the ticket merge the final reviewers and testers, then the Finish block.',
    assigns: 'The lead may start helpers of this block for the plan’s steps.',
    review: 'Who first reviews this block’s change: a change reviewer or the lead.',
    findings: 'The change reviewer passes its verdict and findings to the lead, who decides.',
    rework:
      'This reviewer or the lead may send the change back to its author, up to a number of rounds. A change reviewer that does this works with the helper directly and keeps the lead informed.',
    merge:
      'The lead merges each reviewed change into the ticket branch, through the Checks block before the merge when the workflow has one.',
  } satisfies Record<WorkflowEdgeType, string>,
  edgeName: (type: string, from: string, to: string) => `${type}: from ${from} to ${to}`,
  rework: (n: number) => `Rework ×${formatCount(n)}`,
  chooseEdge: {
    title: 'What does this link do?',
    description: (from: string, to: string) => `From “${from}” to “${to}”. Choose one.`,
    cancel: 'Cancel',
  },
  refused: {
    title: 'That link isn’t allowed',
    dismiss: 'Dismiss',
  },
  panel: {
    label: 'Block settings',
    empty: 'Select a block or a link to change it.',
    close: 'Close settings',
    name: 'Name',
    nameHint: 'What the board and the ticket page call this block.',
    helperNameHint:
      'Plan steps name this helper, so give it a clear role, for example “Frontend helper”.',
    nameRequired: 'Give the block a name.',
    nameTooLong: (max: number) => `Use at most ${formatCount(max)} characters.`,
    descriptionTooLong: (max: number) => `Use at most ${formatCount(max)} characters.`,
    shapeProblem: (label: string) =>
      `“${label}” has a setting that can’t be saved. Check its settings.`,
    nameProblem: (label: string) => `A block needs a name of 1 to 40 characters (“${label}”).`,
    modelHint: 'Leave empty to use the agent file’s model, else the project default.',
    modelDefault: 'Claude Code’s default',
    modelFromFile: (model: string) => `From agent file: ${model}`,
    modelTooLong: 'Use a shorter model name (at most 100 characters).',
    skills: 'Skills',
    skillsHint: (max: number) => `Up to ${formatCount(max)} of the project’s skills.`,
    skillsNone: 'The project has no skills yet.',
    skillsFull: (max: number) => `${formatCount(max)} skills chosen, the most a block can use.`,
    skillMissingTip: (name: string) =>
      `The skill “${name}” is no longer in this project. The agent starts without it.`,
    removeSkill: (name: string) => `Remove ${name}`,
    manage: 'Open Skills & Agents',
    agentFile: 'Agent file',
    agentFileNone: 'None',
    agentFileHint:
      'Its instructions are added to this agent, and its model is used when the block has none. Its tools can only narrow what this kind of block may do.',
    agentFileMissing: 'Agent file not found: the agent starts without it.',
    mode: 'Approval mode',
    modeProjectDefault: (mode: string | null) =>
      mode === null ? 'Project default' : `Project default (${mode})`,
    modeProjectDefaultHint: 'Uses the project’s approval mode, set under Project defaults below.',
    modeCareful:
      'Ticket and run settings can only make this block more careful, never less. A block set to Full auto keeps the sandbox for its commands even then.',
    readOnlyMode:
      'This block never changes a file, so it never asks for approvals: it has no approval mode.',
    description: 'What this helper is for',
    descriptionHint: 'The lead and the planner read this when they hand out the plan’s steps.',
    maxInstances: 'Helpers of this block at once',
    maxInstancesHint: (limit: number) =>
      `The project’s helper limit (${formatCount(limit)}) still applies on top.`,
    maxInstancesValue: (n: number) => countOf(n, 'helper', 'helpers'),
    canStartHelpers: 'May start its own helpers',
    canStartHelpersHint:
      'Helpers from this block may start helpers of their own, within the project’s helper depth.',
    scope: 'What it reviews',
    scopes: {
      change: 'Each change',
      final: 'The merged ticket, at the end',
    },
    scopeHints: {
      change: 'Reads each change it is sent and passes its findings to the lead before it merges.',
      final: 'Reads the merged ticket branch once and posts its findings as ticket comments.',
    },
    planAuto: 'Approve plans automatically',
    planAutoHint:
      'The plan is approved without asking you, but only when the ticket or run is set to Full auto: a more careful ticket or run still asks you.',
    remove: 'Remove block',
    fixed: 'Every workflow has this block, so it can’t be removed.',
    effort: 'Effort',
    effortHint:
      'How much the agent thinks before acting: more effort is slower and uses more tokens.',
    efforts: {
      default: 'Default (the model decides)',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
    } satisfies Record<AgentEffort | 'default', string>,
    links: 'Links from this block',
    noLinks: 'No links from this block yet.',
    linkToNone: 'No block can be linked from here.',
    removeLink: (name: string) => `Remove link ${name}`,
  },
  edgePanel: {
    label: 'Link settings',
    rounds: 'Rework rounds',
    roundsHint:
      'How often the change can be sent back. 0: it can only be merged or discarded. Ticket and run settings can change this for one run.',
    roundsValue: (n: number) =>
      n === 0 ? 'No rework' : countOf(n, 'rework round', 'rework rounds'),
    remove: 'Remove link',
  },
  issues: {
    title: 'Problems',
    tip: 'The workflow is checked as you change it. Problems must be fixed before you can save; warnings are for your information.',
    none: 'No problems. The workflow can be saved.',
    summary: (errors: number, warnings: number) =>
      [
        errors > 0 ? countOf(errors, 'problem to fix', 'problems to fix') : null,
        warnings > 0 ? countOf(warnings, 'warning') : null,
      ]
        .filter((p) => p !== null)
        .join(' · '),
    error: 'Problem',
    warning: 'Warning',
    show: 'Show',
    server: 'The server refused the workflow:',
  },
  templates: {
    button: 'Templates…',
    title: 'Start from a template',
    description:
      'Replaces the blocks and links in the editor. Nothing is saved until you press Save.',
    legend: 'Template',
    styles: {
      'lead-only': 'The lead reviews and merges.',
      'todays-setup': 'A reviewer checks, the lead decides.',
      'reviewer-helper-loop':
        'The reviewer sends changes back to the helper, then the lead merges.',
    } satisfies Record<WorkflowTemplateId, string>,
    planner: 'Add a planner',
    plannerHint:
      'A read-only planner writes the plan, and the lead starts once you approve it. Off: the lead writes the plan itself.',
    use: 'Use this template',
    restoreTitle: 'Restore my earlier setup',
    restoreText:
      'Rebuilds the workflow from the settings this project had before workflows could be drawn.',
    restore: 'Restore my earlier setup',
    confirm: 'This replaces your unsaved changes in the editor.',
    replace: 'Replace',
    cancel: 'Cancel',
  },
  save: {
    save: 'Save',
    saving: 'Saving…',
    discard: 'Discard changes',
    unsaved: 'Unsaved changes',
    saved: 'Saved',
    blocked: 'Fix the problems to save.',
    leave: 'You have unsaved changes to the workflow. Leave without saving them?',
    refused: 'The workflow wasn’t saved.',
  },
  defaults: {
    title: 'Project defaults',
    description: 'Limits and approvals for every helper and tester in this project.',
    tip: 'Shared with Settings. A block set to “Project default” uses this approval mode.',
    saveTitle: 'Save project defaults',
  },
  legend: {
    label: 'Legend',
    agent: 'An agent',
    you: 'You or a step',
  },
  wizard: {
    legend: 'How changes are reviewed',
    hint: 'You can change the workflow on the Workflow page at any time.',
    buildOwn: 'Build my own',
    buildOwnHint: 'Starts from today’s setup. Change it on the Workflow page after setup.',
    failed: 'The workflow wasn’t saved. Try again, or set it up later on the Workflow page.',
  },
} as const;

// --- Session names and run summaries (v0.3.0, S-B; ADR-0024) ------------------------------------
// How the app names a session (lib/session-name.ts) and shows the comments it writes itself.

export const SESSION_NAME_COPY = {
  /** The marker on a session Agent Control Plane started for a ticket or a run. */
  startedByApp: 'Started by Agent Control Plane',
  startedByAppTip:
    'Agent Control Plane started this session for a ticket or a run. It is named after the ticket and the agent’s part in the workflow.',
  /** Link after the marker on the session's own page. */
  openTicket: (key: string) => `Open ${key}`,
  openRun: 'Open the run',
  /** A session without a name, on a known branch: "Session on main · Oct 21, 9:00 AM". */
  onBranch: (branch: string, started: string) => `Session on ${branch} · ${started}`,
  /** A session without a name or a branch: "Session started Oct 21, 9:00 AM". */
  started: (started: string) => `Session started ${started}`,
} as const;

export const RUN_SUMMARY_COPY = {
  /** Who wrote it: the app itself, from what it recorded during the run. */
  author: 'Agent Control Plane',
  authorTip:
    'Written by Agent Control Plane from what it recorded during the run, with the lead agent’s note when it left one.',
  title: 'Run summary',
  /** A later handover's summary of the same run. */
  updatedTitle: 'Run summary (updated)',
  /** Whose words the comment's text is, when the lead left a note: "Lead · Run summary". */
  lead: 'Lead',
  /** The disclosure over the facts the app recorded. */
  details: 'Details',
  /** "Run 2", when the comment belongs to a run of this ticket. */
  ofRun: (n: number) => `Run ${formatCount(n)}`,
  /** The words around the parts of "Merged acp/WEB-12 into main at 1a2b3c4". */
  merge: { merged: 'Merged', into: 'into', at: 'at' },
  /**
   * The words around the pull request lines (G-D): "Merged via pull request #12 into develop at
   * 1a2b3c4", "Pushed feature/WEB-12 and opened pull request #12 into develop", "Pushed
   * feature/WEB-12; pull request #12 into develop was already open".
   */
  pullRequest: {
    mergedVia: (n: number) => `Merged via pull request #${n} into`,
    pushed: 'Pushed',
    opened: (n: number) => `and opened pull request #${n} into`,
    linked: (n: number) => `; pull request #${n} into`,
    alreadyOpen: 'was already open',
  },
} as const;

// --- The harness in the workflow (v0.3.0 part 5, H-D; ADR-0027) ---------------------------------
// Add-only. The Workflow editor's Checks blocks, the Harness page's setup steps and network switch,
// and the ticket's Checks tab grouped by block. Plain owner words: checks, setup, the lead, you.

import type {
  CheckBlockPlace,
  CheckFailureRoute,
  CheckRunPlace,
  CheckSelection,
  SetupRunStatus,
} from '@acp/core';

const PLACE_WORDS = {
  change: 'On each change',
  merge: 'Before the lead’s merge',
  branch: 'On the ticket branch',
} as const satisfies Record<CheckBlockPlace, string>;

export const SETUP_STATUS_COPY: Readonly<Record<SetupRunStatus, ControlStatusCopy>> = {
  passed: { word: 'Passed', tip: 'The step finished without an error.', tone: 'passed' },
  failed: { word: 'Failed', tip: 'The step finished with an error.', tone: 'problem' },
  'timed-out': {
    word: 'Took too long',
    tip: 'The step ran past its time limit and was stopped.',
    tone: 'problem',
  },
  error: {
    word: "Couldn't run",
    tip: "The step couldn't be started, for example because its command isn't installed.",
    tone: 'problem',
  },
  refused: {
    word: 'Not run: needs the network',
    tip: 'This step uses the network, and “Setup may use the network” is off for this project. Turn it on on the Harness page, then try again.',
    tone: 'problem',
  },
  interrupted: {
    word: 'Stopped',
    tip: 'The app stopped before this step finished, so it has no result.',
    tone: 'stopped',
  },
};

export const HARNESS_BLOCKS_COPY = {
  places: PLACE_WORDS,
  placeHints: {
    change: 'Runs on a helper’s or tester’s change before it is reviewed.',
    merge: 'Runs on each change merged with the ticket branch, before the lead merges it.',
    branch:
      'Runs on the finished ticket branch after every change, before your final merge or pull request.',
  } satisfies Record<CheckBlockPlace, string>,
  /** The block's kind on the canvas and in its panel (ADR-0028: plain names for each place). */
  kinds: {
    change: 'Checks on a change',
    merge: 'Checks before merge',
    branch: 'Checks on the branch',
  } satisfies Record<CheckBlockPlace, string>,
  kindText: {
    change: 'Runs the chosen checks on a helper’s or tester’s change before it is reviewed.',
    merge:
      'Runs the chosen checks on each change before the lead merges it into the ticket branch.',
    branch:
      'Runs the chosen checks on the finished ticket branch before your final merge or pull request.',
  } satisfies Record<CheckBlockPlace, string>,
  newLabels: { change: 'Change checks', merge: 'Merge checks', branch: 'Branch checks' },
  palette: {
    group: 'Checks',
    items: {
      change: 'Checks on a change',
      merge: 'Checks before merge',
      branch: 'Checks on the branch',
    },
    hints: {
      change: 'Runs checks on a helper’s change before its review. Linked from a helper.',
      merge: 'Runs checks on each change before the lead merges it. Placed after the lead.',
      branch: 'Runs checks on the finished ticket branch. Added just before the Finish block.',
    },
    noEditors: 'Add a helper or a tester first: these checks run on their changes.',
    allChecked: 'Every helper and tester already has checks on its change.',
    mergeFull: 'The workflow already has checks before the merge; it can have only one.',
    branchFull: 'The workflow already has checks on the branch; it can have only one.',
  },
  /** Every Checks block is optional (ADR-0028 §2): what removing one means, in the panel. */
  optional: {
    change: 'Optional. Without it, the change goes straight to its review.',
    merge: 'Optional. Without it, the lead merges each change after its review, with no checks.',
    branch: 'Optional. Without it, your final merge or pull request is not gated by checks.',
  } satisfies Record<CheckBlockPlace, string>,
  chip: {
    // "Required checks", not "Required": the block itself is optional (ADR-0028 §2).
    required: 'Required checks',
    ids: (n: number) => countOf(n, 'check'),
    labels: (labels: readonly string[]) => labels.join(' · '),
    runs: 'Runs: ',
  },
  panel: {
    nameHint: 'What the canvas and the ticket call this block, for example “Fast checks”.',
    place: 'Where it runs',
    mergePlace: 'This block stays before the lead’s merge. Remove it to merge without checks.',
    branchTaken:
      'The workflow already has checks on the ticket branch, so this one stays on a change.',
    noEditors: 'Add a helper or a tester to run checks on a change.',
    checks: {
      for: (role: string) => `Checks the changes of “${role}”.`,
      unlinked:
        'Not linked to a helper yet. Link a helper or tester to this block with a “Next step” link.',
    },
    select: 'Which checks',
    selectKinds: {
      required: 'All required checks',
      ids: 'Pick checks',
      labels: 'By label',
    } satisfies Record<CheckSelection['kind'], string>,
    selectHints: {
      required: 'Every check the harness file marks as required.',
      ids: 'Only the checks you tick.',
      labels: 'Every check that has one of the labels you choose, for example “fast”.',
    } satisfies Record<CheckSelection['kind'], string>,
    runs: (names: readonly string[]) =>
      names.length === 0
        ? 'No check matches yet, so this block runs nothing.'
        : `Runs: ${names.join(', ')}.`,
    noHarness:
      'This project has no readable harness file yet, so there are no checks to pick from. They come from .acp/harness.json.',
    openHarness: 'Open the Harness page',
    checksLegend: 'Checks to run',
    checksHint: (max: number) => `Up to ${formatCount(max)} checks.`,
    labelsLegend: 'Labels',
    labelsHint: (max: number) => `Up to ${formatCount(max)} labels. Checks with any of them run.`,
    noLabels: 'No check in the harness file has a label yet.',
    labelChecks: (n: number) => countOf(n, 'check'),
    required: 'Required',
    missingCheck: (id: string) => `“${id}” is not in the harness file any more.`,
    missingLabel: (label: string) => `No check has the label “${label}” any more.`,
    remove: (name: string) => `Remove ${name}`,
    empty: (label: string) => `“${label}”: pick at least one check or label.`,
    failure: 'When a check fails',
    failures: {
      lead: 'The lead decides',
      owner: 'Ask me',
      helper: 'Back to the helper',
    } satisfies Record<CheckFailureRoute, string>,
    failureHints: {
      lead: 'The lead is told which checks failed and decides what to do.',
      owner: 'The change waits for you.',
      helper:
        'The change goes back to its helper with the failing checks’ names and the end of their output. The lead is told each round.',
    } satisfies Record<CheckFailureRoute, string>,
    branchFailure:
      'On the ticket branch a failure waits for you: you decide when you merge or open the pull request.',
    rounds: 'Rounds back to the helper',
    roundsHint:
      'How often a failing change goes back to the helper. After the last round the lead decides.',
    roundsValue: (n: number) => (n === 0 ? 'No rounds' : countOf(n, 'round')),
    noReworkLink:
      'This block has no rework link back to its helper yet, so the change can’t go back.',
  },
  harness: {
    run: 'Run setup and checks now',
    running: 'Running setup and checks…',
    runTip:
      'Runs the setup steps, then every check, on a temporary copy of the main branch’s last commit. Your files are not changed.',
    setup: {
      title: 'Setup',
      description: 'Prepares a fresh copy of the project before agents and checks start.',
      tip: 'Each step runs directly, without a shell, in a helper’s or tester’s own copy and in each temporary copy the checks use, never in your project folder. Reading agents never run setup. A failed step stops that start.',
      label: 'Setup steps',
      step: 'Step',
      command: 'Command',
      timeLimit: 'Time limit',
      creates: 'Creates',
      createsTip:
        'Folders the step creates. They are never part of a change, a commit or your project folder.',
      network: 'Uses the network',
      networkTip:
        'This step downloads things. It runs only while “Setup may use the network” is on.',
      none: 'No setup steps',
      noneText:
        'A fresh copy has nothing installed. If checks need dependencies, add a “setup” list to .acp/harness.json.',
    },
    network: {
      label: 'Setup may use the network',
      hint: 'Off by default. While it is off, setup steps marked “Uses the network” do not run, and the ticket says why. The app does not cut steps off from the network: this switch is your consent.',
      on: 'On',
      off: 'Off',
      saving: 'Saving…',
      failed: 'The switch wasn’t saved.',
      blocked: (n: number) =>
        `${countOf(n, 'setup step')} ${n === 1 ? 'uses' : 'use'} the network and won’t run while this is off.`,
      noneUses: 'No setup step uses the network.',
    },
    latestSetup: {
      title: 'Latest setup on the main branch',
      none: 'No setup has run on the main branch yet.',
      label: 'Setup results',
    },
    where: {
      column: 'Where it runs',
      labels: 'Labels',
      tip: 'The Checks blocks in this project’s workflow that run this check.',
      none: 'Not in the workflow',
      block: (place: string, label: string) => `${place}: ${label}`,
    },
  },
  ticket: {
    setupTitle: 'Setup',
    setupTip:
      'The harness setup steps, run in each helper’s or tester’s own copy before it starts and in each temporary copy before checks.',
    setupFor: (role: string) => `For ${role}`,
    setupForChecks: 'For the checks',
    groups: {
      change: PLACE_WORDS.change,
      merge: PLACE_WORDS.merge,
      branch: PLACE_WORDS.branch,
      main: 'Run now on the main branch',
    } satisfies Record<CheckRunPlace, string>,
    groupTips: {
      change: 'Checks blocks on each helper’s change, before its review.',
      merge: 'The checks on each change before the lead merges it into the ticket branch.',
      branch: 'The checks on the ticket branch’s tip; your merge into main counts these.',
      main: 'Run setup and checks now, on the main branch.',
    } satisfies Record<CheckRunPlace, string>,
    output: 'Output (last part)',
    noOutput: 'No output.',
    took: (text: string) => `took ${text}`,
    exitCode: (code: number | null) =>
      code === null ? 'No exit code reported' : `Exit code ${formatCount(code)}`,
  },
} as const;

/**
 * F-1: the ticket branch was changed outside the app (a commit the app did not record, for
 * example a helper that committed on it), and the owner's reset to the last reviewed commit.
 */
export const BRANCH_GUARD_COPY = {
  movedOutside: (branch: string, now: string, reviewed: string) =>
    `${branch} was changed outside the app (now ${now}, last reviewed ${reviewed})`,
  movedHint:
    'Merging or pushing is refused until it is back at the last reviewed commit. Resetting moves only this branch; the commits made outside the app stay in git’s reflog.',
  reset: 'Reset to the last reviewed commit',
  confirmReset: (branch: string, reviewed: string) =>
    `Move ${branch} back to ${reviewed}, the last commit the app reviewed? Nothing else changes.`,
  confirmResetButton: 'Reset branch',
  cancel: 'Cancel',
  working: 'Resetting…',
  failed: 'The branch was not reset',
} as const;

// --- v0.3.1 P-B (ADR-0028): effort per agent, and the Finish block ----------------------------

const EFFORT_WORDS = { low: 'Low', medium: 'Medium', high: 'High' } as const satisfies Record<
  AgentEffort,
  string
>;

/** How an agent block's effort reads on the canvas, the live graph and the agent's details. */
export const EFFORT_COPY = {
  word: EFFORT_WORDS,
  /** The chip on a block: "High effort". Only when the block sets one. */
  chip: (effort: AgentEffort) => `${EFFORT_WORDS[effort]} effort`,
  chipTip:
    'How much the agent thinks before acting, set on this block. More effort is slower and uses more tokens.',
  /** The agent's Details row. */
  detail: 'Effort',
  detailDefault: 'Default (the model decides)',
} as const;

/** "your target branch" when the target is not known; never "main" unless it is main. */
function targetWord(target: string | null): string {
  return target ?? 'your target branch';
}

/** The Finish block: the end of every flow (ADR-0028 §3). */
export const FINISH_COPY = {
  kind: 'You',
  title: 'Finish',
  text: (target: string | null) => `Merge into ${targetWord(target)} or open a pull request`,
  thenDone: 'then Done',
  done: 'Done',
  label: (target: string | null) =>
    `Finish: merge into ${targetWord(target)} or open a pull request, then Done`,
  panelText: (target: string | null) =>
    `You finish every ticket: merge it into ${targetWord(target)} here, or push it and open a pull request. Nothing merges without your click.`,
  stepsTitle: 'What happens here',
  steps: (target: string | null) => [
    'Every change is merged into the ticket branch.',
    `You merge the ticket branch into ${targetWord(target)}, or push it and open a pull request.`,
    'The ticket is done.',
  ],
  fixed: 'Every workflow ends with this block, so it can’t be removed.',
} as const;

/**
 * ADR-0030: "Update target / Resolve conflicts" on the ticket branch. Resolution, verification,
 * review and delivery are shown apart, each with its reason; skipped, unavailable and unverified
 * verification are never worded as passed.
 */
export const RESOLUTION_COPY = {
  title: 'Update from target',
  moved: (target: string) =>
    `${target} has new commits this branch lacks. Update it here: the app merges them in its own copy; a helper resolves any conflicts.`,
  start: (target: string) => `Update from ${target} / Resolve conflicts`,
  starting: 'Starting…',
  blocked: 'Not available now',
  cancel: 'Cancel update',
  cancelConfirm: 'Stop the update? The ticket branch stays as it is.',
  apply: 'Apply anyway',
  applyReason: 'Why apply it although it was not verified?',
  applyPlaceholder: 'For example: reviewed the merge by hand',
  applyPlain: 'Apply update',
  applyHint:
    'It was not verified by checks. Your reason is kept on the ticket; the result still goes to the ticket branch only if nothing moved meanwhile.',
  tooLong: (max: number) => `Keep it under ${max} characters.`,
  back: 'Back',
  working: 'Working…',
  failed: 'The update could not be changed.',
  stale: 'Out of date',
  conflicts: (n: number) => `${n} conflicting file${n === 1 ? '' : 's'}`,
  attempts: 'Attempts',
  candidate: (c: string) => `Candidate ${c.slice(0, 12)}`,
  checked: (c: string) => `on candidate ${c.slice(0, 12)}`,
  selected: 'Selected checks',
  omitted: 'Not run',
  rule: 'Matched rule',
  assessment: 'Assessment',
  dimensions: {
    resolution: 'Resolution',
    verification: 'Verification',
    review: 'Review',
    delivery: 'Delivery',
  },
  resolution: {
    preparing: 'Preparing',
    'up-to-date': 'Already up to date',
    clean: 'Merged without conflicts',
    resolving: 'Resolving',
    resolved: 'Resolved',
    failed: 'Failed',
    cancelled: 'Cancelled',
  },
  verification: {
    pending: 'Assessing',
    running: 'Running selected checks',
    passed: 'Checks passed',
    failed: 'Checks failed',
    'skipped-by-policy': 'Checks skipped by policy',
    'unverified-by-policy': 'Not verified: no automated checks (allowed by policy)',
    unavailable: 'Verification unavailable',
    stale: 'Stale',
  },
  review: {
    'pending-owner': 'Waiting for your review',
    'owner-approved': 'Applied by you',
    'not-required-by-policy': 'Not required by policy',
    stale: 'Stale',
  },
  delivery: {
    'not-delegated': 'You deliver it',
    waiting: 'Waiting',
    pushing: 'Pushing',
    'pr-opened': 'Pull request opened',
    'pr-updated': 'Pull request updated',
    merging: 'Merging',
    merged: 'Merged',
    blocked: 'Blocked',
    unknown: 'Outcome unknown',
  },
  state: {
    preparing: 'Preparing',
    resolving: 'Resolving conflicts',
    verifying: 'Verifying',
    'awaiting-owner': 'Waiting for you',
    delivering: 'Delivering',
    completed: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted by a restart',
  },
} as const;

/** ADR-0030: the project's automation policy (Settings). Conservative unless the owner widens it. */
export const AUTOMATION_COPY = {
  title: 'Conflicts, verification and delivery',
  description:
    'What the app may do by itself when a ticket’s target moves. Each part is separate: automatic resolution never publishes or merges by itself.',
  conflict: {
    label: 'Conflict resolution',
    manual: 'Only when I click Update',
    auto: 'Automatically when the target moves',
    attempts: 'Resolver attempts per update',
  },
  verification: {
    label: 'Verification',
    required: 'Always run the required checks',
    adaptive: 'Adaptive: agents may select checks; approved documentation may skip them',
    skipScopes: 'Documentation scopes that may skip checks (one per line, e.g. docs/** or *.md)',
    alwaysRun: 'Checks that always run (ids, comma separated)',
    unverified: 'Allow delivery when no automated check exists (shown as not verified)',
    missing: 'When checks are needed but none exists',
    escalate: 'Wait for me',
    draft: 'Allow only a draft pull request',
  },
  delivery: {
    label: 'Delivery',
    manual: 'I merge or open the pull request',
    pushPr: 'Push and open or update the pull request',
    merge: 'Merge (locally, or update an open pull request)',
    targets: 'Targets delivery may go to (comma separated)',
  },
  save: 'Save policy',
  saving: 'Saving…',
  saved: 'Saved',
  reset: 'Reset to the safe defaults',
  invalid: 'Check the values: patterns must be repository-relative and targets valid branch names.',
} as const;
