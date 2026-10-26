import { countOf } from '../../lib/copy';
import { formatCount } from '../../lib/format';

/**
 * The words of Files changed (v0.3.0 D-A's review page; the ticket's Files changed tab since C-D).
 * They live with the feature, like the diff viewer's, so WPs that run side by side never edit the
 * same section of `lib/copy.ts`. Plain owner words: a change, its helper, the lead, lines before
 * and after.
 */
export const REVIEW_PAGE_COPY = {
  loading: 'Loading the changed files…',
  round: (round: number) => `Round ${formatCount(round + 1)}`,
  changesMerged: (n: number) => countOf(n, 'change merged', 'changes merged'),
  checksOnTip: 'Checks on the tip:',

  // --- The tab's head: what it shows, and in which state (C-D)
  picker: {
    label: 'Changes from',
    button: (what: string) => `Changes from: ${what}`,
    menu: 'Show changes from',
    all: 'All changes',
    allHint: 'The ticket branch, from its base to its tip',
    change: (role: string) => `${role}’s change`,
  },
  state: {
    open: 'Open',
    merged: 'Merged',
    closed: 'Closed',
  },
  stateTip: {
    open: 'The ticket branch is open: comment on lines and send your review.',
    merged: 'The ticket branch is merged. Its files are read only: no comments or reviews.',
    closed: 'The ticket branch was discarded. Its files are read only.',
  },
  intoWord: 'into',
  mergedWord: 'merged into',
  discarded: 'was discarded',
  mergeCommit: 'Merge commit',
  tipCommit: 'Tip',
  readOnly: 'Read only',
  readOnlyTip:
    'Merged or closed work can’t take comments or reviews. Viewed marks stay in this browser.',
  openInAgents: 'Open in Agents',
  openInAgentsLabel: (role: string) => `Open ${role} in Agents`,
  showAll: 'Show all changes',
  /** The tab can't show the lines. */
  noRun: {
    title: 'Nothing to review yet',
    text: 'This ticket hasn’t started a run, so there are no changed files.',
  },
  noChanges: {
    title: 'No changes yet',
    text: 'This run’s helpers haven’t saved a change yet. Their files show here once they do.',
  },
  noChange: {
    title: 'Change not found',
    text: 'This run has no change from that helper. It may belong to another run of the ticket.',
  },
  noBranch: {
    title: 'No ticket branch yet',
    text: 'The ticket branch is made when the plan is approved. Its files show here after that.',
  },
  changeGone:
    'This change’s own lines are no longer available: the server lists a change only from when it is saved until it is decided. Its work, if merged, is in all changes.',
  notSaved: 'This change isn’t saved yet: its files show here once the helper finishes its turn.',
  gone: {
    title: 'Files no longer available',
    text: 'The commits of this work are no longer in the repository, so its files can’t be shown. Diffs are never stored.',
  },
  loadFailed: 'The changed files couldn’t be loaded.',

  // --- The sticky bar
  bar: 'Review tools',
  summary: (files: number, added: number, removed: number) => ({
    files: countOf(files, 'file changed', 'files changed'),
    added: `+${formatCount(added)}`,
    removed: `−${formatCount(removed)}`,
    sr: `${countOf(files, 'file changed', 'files changed')}, ${countOf(added, 'line added', 'lines added')}, ${countOf(removed, 'line removed', 'lines removed')}`,
  }),
  viewed: (n: number, total: number) => `${formatCount(n)} of ${formatCount(total)} viewed`,
  viewedLabel: (n: number, total: number) =>
    `${formatCount(n)} of ${countOf(total, 'file', 'files')} marked as viewed`,
  collapseAll: 'Collapse all',
  expandAll: 'Expand all',
  showTree: 'Show file tree',
  hideTree: 'Hide file tree',
  shortcuts: 'Keyboard shortcuts',
  shortcutList: [
    ['j', 'Next file'],
    ['k', 'Previous file'],
    ['v', 'Mark the current file as viewed, or not'],
    ['c', 'Comment on the focused line'],
    ['↑ ↓', 'Move between lines once a line’s + is focused'],
  ] as const,
  shortcutsNote: 'Not while you type in a box.',

  // --- The file tree
  tree: 'Changed files',
  filter: 'Filter files',
  filterPlaceholder: 'Filter files…',
  filterEmpty: 'No changed file matches.',
  filterCount: (shown: number, total: number) =>
    `${formatCount(shown)} of ${countOf(total, 'file', 'files')}`,
  viewedMark: 'viewed',
  commentCount: (n: number) => countOf(n, 'pending comment', 'pending comments'),

  // --- A file
  viewedBox: 'Viewed',
  viewedBoxLabel: (path: string) => `Mark ${path} as viewed`,
  offLine: (n: number) =>
    `${countOf(n, 'comment is', 'comments are')} on a line that isn’t in this diff any more:`,
  offFile: (n: number) =>
    `${countOf(n, 'pending comment is', 'pending comments are')} on a file that isn’t in this diff any more:`,

  // --- Line comments
  addComment: (ref: string) => `Comment on ${ref}`,
  lineRef: (line: number, endLine: number, side: 'old' | 'new') =>
    `${endLine === line ? `line ${formatCount(line)}` : `lines ${formatCount(line)}–${formatCount(endLine)}`} ${side === 'old' ? '(before)' : '(after)'}`,
  formLabel: (ref: string) => `Your comment on ${ref}`,
  formHint: 'Shift-click another line’s + to comment on a range. Ctrl+Enter adds it.',
  formPlaceholder: 'Leave a comment',
  add: 'Add to review',
  save: 'Save',
  cancel: 'Cancel',
  edit: 'Edit',
  delete: 'Delete',
  editLabel: (ref: string) => `Edit your comment on ${ref}`,
  deleteLabel: (ref: string) => `Delete your comment on ${ref}`,
  you: 'You',
  pending: 'Pending',
  outdated: (commit: string) => `Written on an earlier version (${commit})`,
  tooLongComment: (max: number) => `Keep a comment under ${formatCount(max)} characters.`,

  // --- Review changes
  reviewButton: 'Review changes',
  reviewButtonLabel: (n: number) =>
    n === 0
      ? 'Review changes'
      : `Review changes, ${countOf(n, 'pending comment', 'pending comments')}`,
  popover: 'Finish your review',
  popoverTitle: 'Finish your review',
  summaryLabel: 'Overall comment',
  summaryHint: 'Optional. It goes after your line comments.',
  summaryPlaceholder: 'Leave an overall comment',
  pendingCount: (n: number) =>
    n === 0 ? 'No comments on lines yet.' : `${countOf(n, 'comment', 'comments')} on lines.`,
  choiceLegend: 'What happens next',
  choices: {
    rework: {
      label: 'Request changes',
      text: 'Send the change back to its helper with your comments as rework notes.',
    },
    'request-changes': {
      label: 'Request changes',
      text: 'Send your comments to the lead; the run continues to make the changes.',
    },
    comment: {
      label: 'Comment',
      text: 'Add your review to the ticket’s comments, without sending it to an agent.',
    },
  },
  reasons: {
    noLoop: 'This run has no review loop, so a change can’t be sent back from here.',
    merged: 'This change is already merged into the ticket branch.',
    discarded: 'This change was discarded.',
    noChanges: 'This helper finished without changing any file.',
    sealing: 'This change is still being saved.',
    leadDecides:
      'The lead decides this change now. You can send it back once the lead asks you, or after the lead ends.',
    noBranch: 'This run has no ticket branch yet.',
    branchWaiting:
      'The agents are still working. You can ask the lead for changes once the branch waits for your review.',
    branchStopped: 'This run has stopped, so there is no lead to send changes to.',
    branchMerged: 'The ticket branch is already merged.',
    branchDiscarded: 'The ticket branch was discarded.',
  },
  preview: 'Preview what is sent',
  length: (n: number, max: number) => `${formatCount(n)} of ${formatCount(max)} characters`,
  tooLong: (n: number, label: string, max: number) =>
    `Your review is ${formatCount(n)} characters; ${label} takes at most ${formatCount(max)}. Shorten or delete some comments. Nothing is cut for you.`,
  empty: 'Add a comment on a line or an overall comment first.',
  submit: 'Submit review',
  sending: 'Sending…',
  failed: 'Your review wasn’t sent.',
  sent: {
    rework: 'Sent to the helper as rework notes.',
    'request-changes': 'Sent to the lead. The run continues.',
    comment: 'Added to Conversation as your review.',
  },
  sentLink: 'Open Conversation',
  /** The entry points on the change card and the ticket branch card. */
  entry: {
    change: 'Review files',
    branch: 'Files changed',
  },
} as const;

/** The words that start the text sent through the owner's decision endpoints. */
export const COMPILED_HEADING = 'Review comments:';
