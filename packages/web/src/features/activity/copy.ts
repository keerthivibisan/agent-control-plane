import { MAX_ATTACHMENTS_PER_TICKET } from '@acp/core';
import { formatCount } from '../../lib/format';

/*
 * The words of the ticket page's Comments and Conversation tabs and of attachments (v0.3.0 C-B,
 * ADR-0026). Kept beside the features (like features/review/copy.ts) so lib/copy.ts, which other
 * work packages edit at the same time, stays untouched.
 */

function countOf(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

export const TICKET_TAB_COPY = {
  label: 'Ticket sections',
  comments: 'Comments',
  agents: 'Agents',
  files: 'Files changed',
  checks: 'Checks',
  conversation: 'Conversation',
} as const;

export const COMMENTS_COPY = {
  /** The Comments tab's thread. */
  thread: 'Comments',
  ticketAttachments: 'Attachments',
  lead: 'Lead',
  summary: {
    title: 'Ticket summary',
    tip: 'The lead’s summary of everything done on this ticket so far. A later run updates it.',
    updated: 'Updated',
    updatedTip: (n: number) =>
      `The lead updated this summary ${n === 1 ? 'once' : `${formatCount(n)} times`}; the newest is shown.`,
    earlier: (n: number) => countOf(n, 'earlier summary', 'earlier summaries'),
  },
  /** The note under the thread that points to the other tab. */
  activityHint: 'What each agent did, reviews, decisions and run facts are in',
  activityLink: 'Conversation',
  /** The comment box's own words; its label, placeholder and buttons are TICKET_COPY.comments. */
  composer: {
    tooLong: 'Too long: at most 8,000 characters.',
    formatting: 'Paragraphs, lists, code and links are shown formatted; HTML is shown as text.',
  },
} as const;

export const ATTACHMENT_COPY = {
  attach: 'Attach files',
  attachTip:
    'Images, text, Markdown, CSV, JSON, PDF, zip or gzip; up to 10 MB each. Agents can read attachments; they never commit them.',
  dropHere: 'Drop files to attach them',
  listLabel: (where: string) => `Attachments of ${where}`,
  uploading: 'Uploading…',
  uploaded: 'Attached',
  remove: (name: string) => `Remove ${name}`,
  open: (name: string) => `Open ${name}`,
  download: (name: string) => `Download ${name}`,
  delete: 'Delete',
  deleteLabel: (name: string) => `Delete ${name}`,
  confirmDelete: (name: string) => `Delete ${name}? Agents can no longer read it.`,
  confirm: 'Delete',
  cancel: 'Cancel',
  deleteFailed: 'The attachment wasn’t deleted.',
  uploadFailed: 'The upload failed.',
  refused: {
    tooBig: (name: string) => `${name} is larger than 10 MB.`,
    empty: (name: string) => `${name} is empty.`,
    type: (name: string) =>
      `${name} isn’t a type you can attach (images, text, Markdown, CSV, JSON, PDF, zip or gzip).`,
    name: (name: string) =>
      `${name} needs a plain file name (no folders, not starting with a dot).`,
    tooMany: `A ticket holds at most ${formatCount(MAX_ATTACHMENTS_PER_TICKET)} attachments.`,
    perComment: (max: number) => `A comment holds at most ${formatCount(max)} attachments.`,
  },
} as const;

export const ACTIVITY_COPY = {
  label: 'Conversation',
  loading: 'Loading the conversation…',
  failed: 'The conversation couldn’t be loaded.',
  empty: 'Nothing has happened yet. Runs, agents’ notes, reviews and decisions show here.',
  filter: 'Show',
  all: 'Everyone',
  noneFor: (who: string) => `Nothing from ${who} yet.`,
  showRun: 'Show this run',
  shownRun: 'Shown on this page',
  showPlan: 'Show the plan',
  planGone: 'This plan version isn’t on the ticket any more.',
  filesChanged: 'Files changed',
  ticketFiles: 'Ticket branch files',
  pullRequest: 'Pull request',
  opensOnGitHub: '(opens on GitHub)',
  /** Labels the page uses for actors in what it reads from the ticket's own comments. */
  actor: {
    owner: 'You',
    lead: 'Lead',
    reviewer: 'Reviewer',
    app: 'Agent Control Plane',
    agent: 'Agent',
  },
  /** Titles of what the page reads from the ticket's own comments (a server without activity). */
  derived: {
    runStarted: (n: number | null) =>
      n === null ? 'Run started' : `Run ${formatCount(n)} started`,
    plan: (v: number) => `Plan version ${formatCount(v)}`,
    agentNote: (who: string) => `${who} reported what it did`,
    review: 'Reviewer findings',
    note: 'Note from the lead',
    runFacts: 'Run facts',
    system: 'Agent Control Plane',
  },
} as const;

export const MERGED_FILES_COPY = {
  readOnly: 'Merged: read only',
  readOnlyTip:
    'This ticket’s work is merged. Its files are read from the recorded commits; there is nothing left to review or decide.',
  unavailable: 'The files of this merge are no longer available',
  unavailableText:
    'The repository no longer has the commits this merge recorded, so its files can’t be shown. The app never stores diffs.',
  loading: 'Loading the merged files…',
  failed: 'The merged files couldn’t be loaded.',
} as const;
