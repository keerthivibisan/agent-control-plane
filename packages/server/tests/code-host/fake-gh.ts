import { readFileSync } from 'node:fs';
import type { CliResult, CliRunner, CliRunOptions } from '../../src/code-host/index.js';
import { git, tempDir } from '../workspace/helpers.js';

/**
 * A fake GitHub CLI for tests (ADR-0025: no network, no real `gh`). It answers the few commands
 * the app runs, keeps its pull requests in memory, and puts a token-like canary in every output
 * the app must never read or pass on (`--version`, `auth status`), so a leak shows up in a test.
 * Synthetic data only.
 */

export const CANARY = 'ghp_CANARYTOKEN0123456789abcdefABCDEF0000';
export const REPO = 'acme/widgets';
export const REMOTE_URL = 'https://github.com/acme/widgets.git';

export interface FakePr {
  number: number;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  baseRefName: string;
  headRefName: string;
  mergedAt: string | null;
  mergeCommit: { oid: string } | null;
  title: string;
  body: string;
  draft: boolean;
  /** G-G: what `gh pr view --json mergeable,mergeStateStatus` says (MERGEABLE / CLEAN by default). */
  mergeable?: string;
  mergeStateStatus?: string;
  /** G-G: the method `gh pr merge` used. */
  mergedWith?: 'merge' | 'squash' | 'rebase';
}

export type FakeGhCommand =
  | 'version'
  | 'auth'
  | 'repo'
  | 'list'
  | 'create'
  | 'view'
  /** `gh api user --jq=.login` (G-E). */
  | 'login'
  /** `gh repo create <target> --private|--public` (G-E). */
  | 'repo-create'
  /** `gh pr merge <n> --repo=… --merge|--squash|--rebase [--delete-branch]` (G-G). */
  | 'merge';

export interface FakeGh {
  run: CliRunner;
  calls: { file: string; args: string[]; options: CliRunOptions }[];
  prs: FakePr[];
  state: {
    installed: boolean;
    loggedIn: boolean;
    defaultBranch: string | null;
    /** The logged-in account (G-E). */
    login: string;
    /** G-G: the repository's allowed merge methods (`gh repo view --json …Allowed`). */
    methods: {
      mergeCommitAllowed: boolean;
      squashMergeAllowed: boolean;
      rebaseMergeAllowed: boolean;
    };
    /** G-G: the local bare "GitHub" repository, where `--delete-branch` deletes the head. */
    bare: string | null;
    /** G-G: the merge commit `gh pr merge` reports (null: none). */
    mergeOid: string | null;
  };
  /** Repositories "GitHub" has, as `owner/name`; `repo create` refuses one that exists (G-E). */
  repos: { slug: string; visibility: string }[];
  /** A canned result for a command (an exit code, a timeout, garbage output). */
  fail: Partial<Record<FakeGhCommand, CliResult>>;
  /** Marks a pull request merged on "GitHub". */
  merge(number: number, oid?: string): void;
  close(number: number): void;
}

const flag = (args: readonly string[], name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const ok = (stdout: string): CliResult => ({
  exitCode: 0,
  stdout,
  timedOut: false,
  notFound: false,
});

export function commandOf(args: readonly string[]): FakeGhCommand | null {
  if (args[0] === '--version') return 'version';
  if (args[0] === 'auth' && args[1] === 'status') return 'auth';
  if (args[0] === 'repo' && args[1] === 'view') return 'repo';
  if (args[0] === 'repo' && args[1] === 'create') return 'repo-create';
  if (args[0] === 'api' && args.includes('user')) return 'login';
  if (args[0] === 'pr' && args[1] === 'merge') return 'merge';
  if (args[0] === 'pr' && (args[1] === 'list' || args[1] === 'create' || args[1] === 'view')) {
    return args[1];
  }
  return null;
}

export function createFakeGh(): FakeGh {
  const calls: FakeGh['calls'] = [];
  const prs: FakePr[] = [];
  const state = {
    installed: true,
    loggedIn: true,
    defaultBranch: 'main' as string | null,
    login: 'octo',
    methods: { mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true },
    bare: null as string | null,
    mergeOid: null as string | null,
  };
  const repos: FakeGh['repos'] = [];
  const fail: FakeGh['fail'] = {};
  let next = 12;

  const view = (pr: FakePr) => ({
    number: pr.number,
    url: pr.url,
    state: pr.state,
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    mergedAt: pr.mergedAt,
    mergeCommit: pr.mergeCommit,
    isDraft: pr.draft,
    mergeable: pr.mergeable ?? 'MERGEABLE',
    mergeStateStatus: pr.mergeStateStatus ?? (pr.draft ? 'DRAFT' : 'CLEAN'),
  });

  const run: CliRunner = (file, args, options) => {
    calls.push({ file, args: [...args], options });
    const command = commandOf(args);
    if (!state.installed) {
      return Promise.resolve({ exitCode: null, stdout: '', timedOut: false, notFound: true });
    }
    if (command !== null && fail[command] !== undefined) return Promise.resolve(fail[command]);
    // Every command of the app names the repository (or the host) explicitly.
    if (command === 'list' || command === 'create' || command === 'view' || command === 'merge') {
      if (flag(args, 'repo') !== REPO) return Promise.resolve({ ...ok(''), exitCode: 1 });
    }
    switch (command) {
      case 'version':
        return Promise.resolve(ok(`gh version 9.9.9 ${CANARY}\n`));
      case 'auth':
        return Promise.resolve({
          ...ok(`Logged in to github.com account octo (keyring) token ${CANARY}\n`),
          exitCode: state.loggedIn ? 0 : 1,
        });
      case 'repo':
        return Promise.resolve(
          ok(
            JSON.stringify({
              defaultBranchRef: state.defaultBranch === null ? null : { name: state.defaultBranch },
              ...state.methods,
            }),
          ),
        );
      case 'list': {
        const head = flag(args, 'head');
        return Promise.resolve(
          ok(
            JSON.stringify(
              prs
                .filter((p) => p.headRefName === head && p.state === 'OPEN')
                .map(({ number, url, state: st, baseRefName, headRefName }) => ({
                  number,
                  url,
                  state: st,
                  baseRefName,
                  headRefName,
                })),
            ),
          ),
        );
      }
      case 'create': {
        const bodyFile = flag(args, 'body-file') ?? '';
        const pr: FakePr = {
          number: next++,
          url: '',
          state: 'OPEN',
          baseRefName: flag(args, 'base') ?? '',
          headRefName: flag(args, 'head') ?? '',
          mergedAt: null,
          mergeCommit: null,
          title: flag(args, 'title') ?? '',
          body: readFileSync(bodyFile, 'utf8'),
          draft: args.includes('--draft'),
        };
        pr.url = `https://github.com/${REPO}/pull/${pr.number}`;
        prs.push(pr);
        return Promise.resolve(ok(`Creating pull request\n${pr.url}\n`));
      }
      case 'view': {
        const pr = prs.find((p) => String(p.number) === args[2]);
        if (pr === undefined) return Promise.resolve({ ...ok(''), exitCode: 1 });
        return Promise.resolve(ok(JSON.stringify(view(pr))));
      }
      case 'login':
        if (!state.loggedIn) return Promise.resolve({ ...ok(''), exitCode: 4 });
        return Promise.resolve(ok(`${state.login}\n`));
      case 'repo-create': {
        // Exactly `repo create <target> --private|--public`: nothing else is accepted.
        const [, , target, visibility, ...rest] = args;
        if (
          target === undefined ||
          (visibility !== '--private' && visibility !== '--public') ||
          rest.length > 0
        ) {
          return Promise.resolve({ ...ok(''), exitCode: 2 });
        }
        const slug = target.includes('/') ? target : `${state.login}/${target}`;
        if (repos.some((r) => r.slug.toLowerCase() === slug.toLowerCase())) {
          return Promise.resolve({ ...ok(`already exists ${CANARY}\n`), exitCode: 1 });
        }
        repos.push({ slug, visibility: visibility.slice(2) });
        // gh prints the new repository's URL; the app does not read it.
        return Promise.resolve(ok(`https://github.com/${slug} ${CANARY}\n`));
      }
      case 'merge': {
        // Exactly `pr merge <n> --repo=… --<method> [--delete-branch]`: nothing else is accepted.
        const [, , n, repo, method, ...rest] = args;
        const del = rest.length === 1 && rest[0] === '--delete-branch';
        if (
          repo !== `--repo=${REPO}` ||
          (method !== '--merge' && method !== '--squash' && method !== '--rebase') ||
          (rest.length > 0 && !del)
        ) {
          return Promise.resolve({ ...ok(''), exitCode: 2 });
        }
        const pr = prs.find((p) => String(p.number) === n);
        const refused = { ...ok(`refused ${CANARY}\n`), exitCode: 1 };
        if (pr === undefined || pr.state !== 'OPEN' || pr.draft) return Promise.resolve(refused);
        const allowed = {
          '--merge': state.methods.mergeCommitAllowed,
          '--squash': state.methods.squashMergeAllowed,
          '--rebase': state.methods.rebaseMergeAllowed,
        }[method];
        const status = pr.mergeStateStatus ?? 'CLEAN';
        if (!allowed || pr.mergeable === 'CONFLICTING' || !['CLEAN', 'UNSTABLE'].includes(status)) {
          return Promise.resolve(refused);
        }
        pr.state = 'MERGED';
        pr.mergedAt = '2026-10-23T10:00:00Z';
        pr.mergeCommit = state.mergeOid === null ? null : { oid: state.mergeOid };
        pr.mergedWith = method.slice(2) as 'merge' | 'squash' | 'rebase';
        if (del && state.bare !== null && bareTip(state.bare, pr.headRefName) !== null) {
          git(state.bare, 'update-ref', '-d', `refs/heads/${pr.headRefName}`);
        }
        return Promise.resolve(ok(`Merged pull request #${pr.number} ${CANARY}\n`));
      }
      default:
        return Promise.resolve({ ...ok(''), exitCode: 2 });
    }
  };

  return {
    run,
    calls,
    prs,
    state,
    repos,
    fail,
    merge(number, oid) {
      const pr = prs.find((p) => p.number === number);
      if (pr === undefined) throw new Error(`no pull request #${number}`);
      pr.state = 'MERGED';
      pr.mergedAt = '2026-10-22T10:00:00Z';
      pr.mergeCommit = oid === undefined ? null : { oid };
    },
    close(number) {
      const pr = prs.find((p) => p.number === number);
      if (pr === undefined) throw new Error(`no pull request #${number}`);
      pr.state = 'CLOSED';
    },
  };
}

/**
 * `repo`'s `origin` is `https://github.com/acme/widgets.git`, which git rewrites (`insteadOf`, in
 * the repository's own config) to a local bare repository: pushes land there, and the app still
 * sees a GitHub remote. Nothing reaches the network.
 */
export function withBareOrigin(repo: string): string {
  const bare = tempDir('acp-bare-');
  git(bare, 'init', '--quiet', '--bare');
  git(repo, 'remote', 'add', 'origin', REMOTE_URL);
  git(repo, 'config', `url.${bare}.insteadOf`, REMOTE_URL);
  return bare;
}

export const bareTip = (bare: string, branch: string): string | null => {
  try {
    return git(bare, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).trim();
  } catch {
    return null;
  }
};
