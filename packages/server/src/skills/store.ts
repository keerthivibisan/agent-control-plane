import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { SkillName } from '@acp/core';
import { SkillNameSchema } from '@acp/core';
import type { SkillCommitResultDto } from '@acp/core/api';
import { HttpError } from '../errors.js';
import { errorFields, type Logger } from '../logger.js';
import { GitCommandError, SAFE_GIT_CONFIG, type GitRunner } from '../workspace/index.js';
import { skillError } from './errors.js';
import {
  encodeText,
  readTargetFile,
  realRoot,
  refusePersonalClaudeDir,
  removeTargetFile,
  targetExists,
  writeTargetFile,
  type FileTarget,
  type Listed,
  type ReadResult,
} from './paths.js';

/**
 * The shared core of the Skills and Agents APIs (ADR-0018 and its amendment): one project file per
 * name, written only on an owner request (the routers require CSRF), with git state and a commit of
 * just that file's scope. A kind (skills, agents) supplies its paths, file format and DTO; this
 * module owns the path rules, atomic writes, git and the refusals, so both kinds behave the same.
 * Only `git` runs, with argument arrays (ADR-0013 §1). File contents are never logged.
 */

export interface ProjectRef {
  id: string;
  rootPath: string;
}

export interface FileStoreDeps {
  git: GitRunner;
  logger?: Logger;
  /** The owner's home folder, whose `.claude` is never opened. Injected so tests never use it. */
  homeDir?: string;
}

/** What the store knows about one file, for the kind to turn into its DTO. */
export interface StoredFile {
  name: SkillName;
  target: FileTarget;
  /** The read file, or null when it could not be opened (the reason is in `problems`). */
  text: string | null;
  problems: string[];
  sizeBytes: number;
  lastCommittedAt: string | null;
  uncommitted: boolean;
}

export interface FileKind<W extends { name: SkillName }, D> {
  /** Commit message scope, `chore(<scope>): …`, and the log label. */
  scope: 'skills' | 'agents';
  /** "skill" or "agent definition", for messages. */
  noun: string;
  maxBytes: number;
  target(root: string, name: string): FileTarget;
  list(root: string): Promise<Listed>;
  /** The problem for a target whose file is missing (a skill folder without SKILL.md). */
  missingProblem: string;
  /** Parses a write request; an oversize text throws `too_large`. */
  parseWrite(body: unknown): W;
  /** The new file text; `current` is the file being replaced (its unmanaged keys are kept). */
  serialize(request: W, current: string | null): string;
  toDetail(project: ProjectRef, file: StoredFile): Promise<D>;
  /** Refuses a delete (skills: while a workflow stage uses the skill). */
  beforeDelete?(project: ProjectRef, name: SkillName): Promise<void>;
}

export interface FileStore<D> {
  list(project: ProjectRef): Promise<D[]>;
  get(project: ProjectRef, name: string): Promise<D>;
  create(project: ProjectRef, body: unknown): Promise<D>;
  update(project: ProjectRef, name: string, body: unknown): Promise<D>;
  delete(project: ProjectRef, name: string): Promise<void>;
  commit(project: ProjectRef, name: string): Promise<SkillCommitResultDto>;
}

export function parseName(name: string): SkillName {
  const parsed = SkillNameSchema.safeParse(name);
  if (!parsed.success) {
    throw skillError(
      'invalid_request',
      'A name uses lowercase letters, digits and dashes (up to 64), starting with a letter or digit',
    );
  }
  return parsed.data;
}

/** One write at a time per project root, shared by every kind, so writes and commits never interleave. */
const locks = new Map<string, Promise<unknown>>();
function serialized<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(root) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const settled = next.catch(() => undefined);
  locks.set(root, settled);
  void settled.then(() => {
    if (locks.get(root) === settled) locks.delete(root);
  });
  return next;
}

export function createFileStore<W extends { name: SkillName }, D>(
  deps: FileStoreDeps,
  kind: FileKind<W, D>,
): FileStore<D> {
  const { git } = deps;
  const logger = deps.logger ?? { log() {} };
  const homeDir = deps.homeDir ?? homedir();

  function run(root: string, args: readonly string[]) {
    return git([...SAFE_GIT_CONFIG, ...args], { cwd: root });
  }

  async function probe(root: string, args: readonly string[]): Promise<string | null> {
    try {
      return (await run(root, args)).stdout;
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  }

  /** The real root and its path prefix inside the repository (`''` at the top level). */
  async function repo(project: ProjectRef): Promise<{ root: string; prefix: string }> {
    const root = await realRoot(project.rootPath);
    await refusePersonalClaudeDir(root, homeDir);
    const prefix = await probe(root, ['rev-parse', '--show-prefix']);
    if (prefix === null) {
      throw skillError('not_a_git_repo', 'The project folder is not a git repository');
    }
    return { root, prefix: prefix.trim() };
  }

  async function hasHead(root: string): Promise<boolean> {
    return (await probe(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])) !== null;
  }

  function label(target: FileTarget): string {
    return target.file.slice(target.dir.length + 1);
  }

  async function stored(root: string, name: SkillName, head: boolean): Promise<StoredFile> {
    const target = kind.target(root, name);
    const problems: string[] = [];
    let text: string | null = null;
    let sizeBytes = 0;
    let read: ReadResult;
    try {
      read = await readTargetFile(target, kind.maxBytes);
    } catch (error) {
      // A linked or odd file inside an otherwise safe folder: show it, don't fail the list.
      if (!(error instanceof HttpError) || error.code !== 'unsafe_path') throw error;
      problems.push(`${error.message}, so the app does not open it.`);
      read = { kind: 'missing' };
    }
    if (problems.length === 0) {
      if (read.kind === 'missing') {
        problems.push(kind.missingProblem);
      } else if (read.kind === 'too-large') {
        sizeBytes = read.sizeBytes;
        problems.push(
          `${label(target)} is larger than ${kind.maxBytes / 1024} KiB, so the app does not open it.`,
        );
      } else if (read.kind === 'not-text') {
        sizeBytes = read.sizeBytes;
        problems.push(`${label(target)} is not UTF-8 text, so the app does not open it.`);
      } else {
        sizeBytes = read.sizeBytes;
        text = read.text;
      }
    }
    const status = await run(root, [
      'status',
      '--porcelain',
      '-z',
      '--untracked-files=all',
      '--',
      target.relFile,
    ]);
    let lastCommittedAt: string | null = null;
    if (head) {
      const log = (await run(root, ['log', '-1', '--format=%cI', '--', target.relFile])).stdout;
      if (log.trim() !== '') lastCommittedAt = new Date(log.trim()).toISOString();
    }
    return {
      name,
      target,
      text,
      problems,
      sizeBytes,
      lastCommittedAt,
      uncommitted: status.stdout !== '',
    };
  }

  async function detail(project: ProjectRef, root: string, name: SkillName): Promise<D> {
    return kind.toDetail(project, await stored(root, name, await hasHead(root)));
  }

  async function existing(root: string, name: SkillName): Promise<FileTarget> {
    const target = kind.target(root, name);
    if (!(await targetExists(target))) {
      throw skillError('not_found', `No ${kind.noun} named ${name}`);
    }
    return target;
  }

  async function write(
    project: ProjectRef,
    target: FileTarget,
    request: W,
    current: string | null,
    action: 'create' | 'update',
  ): Promise<void> {
    const bytes = encodeText(kind.serialize(request, current), kind.maxBytes, label(target));
    await writeTargetFile(target, bytes);
    logger.log('info', `${kind.scope} file written`, {
      projectId: project.id,
      name: request.name,
      action,
      bytes: bytes.length,
    });
  }

  return {
    async list(project) {
      const { root } = await repo(project);
      const head = await hasHead(root);
      const { names, skipped } = await kind.list(root);
      if (skipped > 0) {
        logger.log('debug', `${kind.scope} entries skipped`, { projectId: project.id, skipped });
      }
      const out: D[] = [];
      for (const name of names) {
        out.push(await kind.toDetail(project, await stored(root, parseName(name), head)));
      }
      return out;
    },

    async get(project, rawName) {
      const name = parseName(rawName);
      const { root } = await repo(project);
      await existing(root, name);
      return detail(project, root, name);
    },

    async create(project, body) {
      const request = kind.parseWrite(body);
      const { root } = await repo(project);
      return serialized(root, async () => {
        const target = kind.target(root, request.name);
        if (await targetExists(target)) {
          throw skillError('conflict', `A ${kind.noun} named ${request.name} already exists`);
        }
        await write(project, target, request, null, 'create');
        return detail(project, root, request.name);
      });
    },

    async update(project, rawName, body) {
      const name = parseName(rawName);
      const request = kind.parseWrite(body);
      if (request.name !== name) {
        throw skillError('invalid_request', `A ${kind.noun} cannot be renamed; create a new one`);
      }
      const { root } = await repo(project);
      return serialized(root, async () => {
        const target = await existing(root, name);
        const current = await readTargetFile(target, kind.maxBytes);
        await write(
          project,
          target,
          request,
          current.kind === 'ok' ? current.text : null,
          'update',
        );
        return detail(project, root, name);
      });
    },

    async delete(project, rawName) {
      const name = parseName(rawName);
      const { root } = await repo(project);
      await serialized(root, async () => {
        await kind.beforeDelete?.(project, name);
        if (!(await removeTargetFile(kind.target(root, name)))) {
          throw skillError('not_found', `No ${kind.noun} named ${name}`);
        }
        logger.log('info', `${kind.scope} file removed`, { projectId: project.id, name });
      });
    },

    async commit(project, rawName) {
      const name = parseName(rawName);
      const { root, prefix } = await repo(project);
      return serialized(root, async () => {
        const target = kind.target(root, name);
        const branch = (await probe(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']))?.trim();
        if (branch === undefined || branch === '') {
          throw skillError(
            'detached_head',
            'No branch is checked out, so there is nowhere to commit',
          );
        }
        // A commit of this file must never sweep in the owner's own staged work (ADR-0018 §4).
        const scope = `${prefix}${target.relScope}`;
        const staged = (await run(root, ['diff', '--cached', '--name-only', '-z'])).stdout
          .split('\0')
          .filter((p) => p !== '');
        const others = staged.filter((p) => p !== scope && !p.startsWith(`${scope}/`));
        if (others.length > 0) {
          throw skillError(
            'staged_changes',
            `Other files are staged (${others.length}). Commit or unstage them first, so this commit holds only the ${kind.noun}.`,
          );
        }
        const status = await run(root, [
          'status',
          '--porcelain',
          '-z',
          '--untracked-files=all',
          '--',
          target.relScope,
        ]);
        if (status.stdout === '') {
          throw skillError(
            'nothing_to_commit',
            `The ${kind.noun} ${name} has no uncommitted changes`,
          );
        }
        const head = await hasHead(root);
        const inHead =
          head &&
          (await run(root, ['ls-tree', '--name-only', 'HEAD', '--', target.relFile])).stdout !== '';
        const verb = !existsSync(target.file) ? 'remove' : inHead ? 'update' : 'create';
        try {
          await run(root, ['add', '--all', '--', target.relScope]);
          await run(root, [
            'commit',
            '--quiet',
            '-m',
            `chore(${kind.scope}): ${verb} ${name}`,
            '--',
            target.relScope,
          ]);
        } catch (error) {
          if (!(error instanceof GitCommandError)) throw error;
          logger.log('warn', `${kind.scope} commit failed`, {
            projectId: project.id,
            name,
            ...errorFields(error),
          });
          const identity = /tell me who you are|auto-detect email|empty ident/i.test(error.stderr);
          throw skillError(
            'git_failed',
            identity
              ? 'git could not commit: set user.name and user.email in your git config'
              : `git could not commit the ${kind.noun}`,
          );
        }
        const commit = (await run(root, ['rev-parse', 'HEAD'])).stdout.trim();
        logger.log('info', `${kind.scope} file committed`, { projectId: project.id, name, verb });
        return { name, commit, branch };
      });
    },
  };
}
