import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  MAX_SKILL_BYTES,
  MAX_SKILL_DESCRIPTION,
  SkillNameSchema,
  defaultProjectWorkflow,
  stagesUsingSkill,
  type ProjectWorkflow,
  type SkillName,
  type WorkflowStageId,
} from '@acp/core';
import {
  SkillWriteRequestSchema,
  type SkillCommitResultDto,
  type SkillDetailDto,
  type SkillSummaryDto,
  type SkillWriteRequest,
} from '@acp/core/api';
import { HttpError } from '../errors.js';
import { errorFields, type Logger } from '../logger.js';
import { GitCommandError, SAFE_GIT_CONFIG, type GitRunner } from '../workspace/index.js';
import { skillError } from './errors.js';
import { parseSkillFile, serializeSkillFile } from './frontmatter.js';
import {
  encodeSkillText,
  ensureSkillDir,
  listSkillFolders,
  readSkillFile,
  realRoot,
  refusePersonalClaudeDir,
  removeSkillFile,
  skillDirExists,
  skillPaths,
  writeSkillFile,
  type SkillPaths,
} from './paths.js';

/**
 * Project skills (ADR-0018, docs/redesign/README.md §4.3): list, read, write and commit
 * `<project>/.claude/skills/<slug>/SKILL.md`. Every write is an owner request through the Skills
 * page (the router requires CSRF); only `git` runs, with argument arrays (ADR-0013 §1). File
 * contents are never logged.
 */

export interface SkillProject {
  id: string;
  rootPath: string;
}

export interface SkillsServiceDeps {
  git: GitRunner;
  now: () => Date;
  /** The project's workflow, for "used by" and the delete guard. Default: the default workflow. */
  workflowOf?: (projectId: string) => ProjectWorkflow | Promise<ProjectWorkflow>;
  logger?: Logger;
  /** The owner's home folder, whose `.claude` is never opened. Injected so tests never use it. */
  homeDir?: string;
}

export interface SkillsService {
  list(project: SkillProject): Promise<SkillSummaryDto[]>;
  get(project: SkillProject, name: string): Promise<SkillDetailDto>;
  create(project: SkillProject, body: unknown): Promise<SkillDetailDto>;
  update(project: SkillProject, name: string, body: unknown): Promise<SkillDetailDto>;
  delete(project: SkillProject, name: string): Promise<void>;
  commit(project: SkillProject, name: string): Promise<SkillCommitResultDto>;
}

const STAGE_LABEL: Record<WorkflowStageId, string> = {
  plan: 'Plan',
  orchestrate: 'Orchestrate',
  helpers: 'Helpers',
  review: 'Review and merge',
  'code-review': 'Final code review',
  'unit-tests': 'Unit tests',
};

function parseName(name: string): SkillName {
  const parsed = SkillNameSchema.safeParse(name);
  if (!parsed.success) {
    throw skillError(
      'invalid_request',
      'A skill name uses lowercase letters, digits and dashes (up to 64)',
    );
  }
  return parsed.data;
}

/** The request body; an oversize text gets `too_large` rather than a generic schema error. */
function parseWrite(body: unknown): SkillWriteRequest {
  const parsed = SkillWriteRequestSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const instructions = (body as { instructions?: unknown } | null)?.instructions;
  if (typeof instructions === 'string' && Buffer.byteLength(instructions) > MAX_SKILL_BYTES) {
    throw skillError('too_large', `SKILL.md can be at most ${MAX_SKILL_BYTES / 1024} KiB`);
  }
  throw parsed.error;
}

function listStages(stages: readonly WorkflowStageId[]): string {
  return stages.map((s) => STAGE_LABEL[s]).join(', ');
}

export function createSkillsService(deps: SkillsServiceDeps): SkillsService {
  const { git, now } = deps;
  const logger = deps.logger ?? { log() {} };
  const homeDir = deps.homeDir ?? homedir();
  const workflowOf =
    deps.workflowOf ??
    ((projectId: string) => defaultProjectWorkflow(projectId, now().toISOString()));

  /** One write at a time per project, so two clicks never interleave a write and a commit. */
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
  async function repo(project: SkillProject): Promise<{ root: string; prefix: string }> {
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

  async function usedBy(project: SkillProject, name: SkillName): Promise<WorkflowStageId[]> {
    return stagesUsingSkill(await workflowOf(project.id), name);
  }

  async function detail(
    project: SkillProject,
    root: string,
    name: SkillName,
    head: boolean,
  ): Promise<SkillDetailDto> {
    const paths = skillPaths(root, name);
    const problems: string[] = [];
    let description = '';
    let instructions = '';
    let sizeBytes = 0;
    try {
      const read = await readSkillFile(paths);
      if (read.kind === 'missing') {
        problems.push('There is no SKILL.md in this folder, so Claude Code ignores it.');
      } else if (read.kind === 'too-large') {
        sizeBytes = read.sizeBytes;
        problems.push(
          `SKILL.md is larger than ${MAX_SKILL_BYTES / 1024} KiB, so the app does not open it.`,
        );
      } else if (read.kind === 'not-text') {
        sizeBytes = read.sizeBytes;
        problems.push('SKILL.md is not UTF-8 text, so the app does not open it.');
      } else {
        sizeBytes = read.sizeBytes;
        const parsed = parseSkillFile(read.text);
        problems.push(...parsed.problems);
        instructions = parsed.body;
        if (parsed.fields !== null) {
          const fmName = parsed.fields['name'];
          if (fmName === undefined || fmName === '') {
            problems.push('The front matter has no name.');
          } else if (fmName !== name) {
            problems.push('The name in the front matter differs from the folder name.');
          }
          description = parsed.fields['description'] ?? '';
          if (description.trim() === '') {
            problems.push(
              'The front matter has no description, so Claude Code cannot tell when to use the skill.',
            );
          } else if (description.length > MAX_SKILL_DESCRIPTION) {
            description = description.slice(0, MAX_SKILL_DESCRIPTION);
            problems.push(
              `The description is longer than ${MAX_SKILL_DESCRIPTION} characters; only the start is shown.`,
            );
          }
        }
      }
    } catch (error) {
      // A linked or odd SKILL.md inside an otherwise safe folder: show it, don't fail the list.
      if (!(error instanceof HttpError) || error.code !== 'unsafe_path') throw error;
      problems.push(`${error.message}, so the app does not open it.`);
    }

    const status = await run(root, [
      'status',
      '--porcelain',
      '-z',
      '--untracked-files=all',
      '--',
      paths.relFile,
    ]);
    let lastCommittedAt: string | null = null;
    if (head) {
      const log = (
        await run(root, ['log', '-1', '--format=%cI', '--', paths.relFile])
      ).stdout.trim();
      if (log !== '') lastCommittedAt = new Date(log).toISOString();
    }
    return {
      name,
      description,
      path: paths.relFile,
      usedBy: await usedBy(project, name),
      sizeBytes,
      lastCommittedAt,
      uncommitted: status.stdout !== '',
      problems,
      instructions,
    };
  }

  function summaryOf(d: SkillDetailDto): SkillSummaryDto {
    const { instructions: _instructions, ...summary } = d;
    return summary;
  }

  async function existingFolder(root: string, name: SkillName): Promise<SkillPaths> {
    const paths = skillPaths(root, name);
    if (!(await skillDirExists(paths))) throw skillError('not_found', `No skill named ${name}`);
    return paths;
  }

  async function write(
    project: SkillProject,
    paths: SkillPaths,
    request: SkillWriteRequest,
    extraLines: readonly string[],
    action: 'create' | 'update',
  ): Promise<void> {
    const bytes = encodeSkillText(
      serializeSkillFile({
        name: request.name,
        description: request.description,
        instructions: request.instructions,
        extraLines,
      }),
    );
    await ensureSkillDir(paths);
    await writeSkillFile(paths, bytes);
    logger.log('info', 'skill written', {
      projectId: project.id,
      skill: request.name,
      action,
      bytes: bytes.length,
    });
  }

  return {
    async list(project) {
      const { root } = await repo(project);
      const head = await hasHead(root);
      const { names, skipped } = await listSkillFolders(root);
      if (skipped > 0) {
        logger.log('debug', 'skill folders skipped', { projectId: project.id, skipped });
      }
      const out: SkillSummaryDto[] = [];
      for (const name of names) out.push(summaryOf(await detail(project, root, name, head)));
      return out;
    },

    async get(project, rawName) {
      const name = parseName(rawName);
      const { root } = await repo(project);
      await existingFolder(root, name);
      return detail(project, root, name, await hasHead(root));
    },

    async create(project, body) {
      const request = parseWrite(body);
      const { root } = await repo(project);
      return serialized(root, async () => {
        const paths = skillPaths(root, request.name);
        if (await skillDirExists(paths)) {
          throw skillError('conflict', `A skill named ${request.name} already exists`);
        }
        await write(project, paths, request, [], 'create');
        return detail(project, root, request.name, await hasHead(root));
      });
    },

    async update(project, rawName, body) {
      const name = parseName(rawName);
      const request = parseWrite(body);
      if (request.name !== name) {
        throw skillError('invalid_request', 'A skill cannot be renamed; create a new one instead');
      }
      const { root } = await repo(project);
      return serialized(root, async () => {
        const paths = await existingFolder(root, name);
        // Keep front-matter keys the app does not edit (for example `allowed-tools`).
        const current = await readSkillFile(paths);
        const extraLines = current.kind === 'ok' ? parseSkillFile(current.text).extraLines : [];
        await write(project, paths, request, extraLines, 'update');
        return detail(project, root, name, await hasHead(root));
      });
    },

    async delete(project, rawName) {
      const name = parseName(rawName);
      const { root } = await repo(project);
      await serialized(root, async () => {
        const stages = await usedBy(project, name);
        if (stages.length > 0) {
          throw skillError(
            'skill_in_use',
            `The skill is used by these workflow stages: ${listStages(stages)}. Remove it from them first.`,
          );
        }
        const paths = skillPaths(root, name);
        if (!(await removeSkillFile(paths)))
          throw skillError('not_found', `No skill named ${name}`);
        logger.log('info', 'skill removed', { projectId: project.id, skill: name });
      });
    },

    async commit(project, rawName) {
      const name = parseName(rawName);
      const { root, prefix } = await repo(project);
      return serialized(root, async () => {
        const paths = skillPaths(root, name);
        const branch = (await probe(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']))?.trim();
        if (branch === undefined || branch === '') {
          throw skillError(
            'detached_head',
            'No branch is checked out, so there is nowhere to commit',
          );
        }
        // A skill commit must never sweep in the owner's own staged work (ADR-0018 §4).
        const folder = `${prefix}${paths.relDir}/`;
        const staged = (await run(root, ['diff', '--cached', '--name-only', '-z'])).stdout
          .split('\0')
          .filter((p) => p !== '');
        const others = staged.filter((p) => !p.startsWith(folder));
        if (others.length > 0) {
          throw skillError(
            'staged_changes',
            `Other files are staged (${others.length}). Commit or unstage them first, so the skill commit holds only the skill.`,
          );
        }
        const status = await run(root, [
          'status',
          '--porcelain',
          '-z',
          '--untracked-files=all',
          '--',
          paths.relDir,
        ]);
        if (status.stdout === '') {
          throw skillError('nothing_to_commit', `The skill ${name} has no uncommitted changes`);
        }
        const head = await hasHead(root);
        const inHead =
          head &&
          (await run(root, ['ls-tree', '--name-only', 'HEAD', '--', paths.relFile])).stdout !== '';
        const verb = !existsSync(paths.file) ? 'remove' : inHead ? 'update' : 'create';
        try {
          await run(root, ['add', '--all', '--', paths.relDir]);
          await run(root, [
            'commit',
            '--quiet',
            '-m',
            `chore(skills): ${verb} ${name}`,
            '--',
            paths.relDir,
          ]);
        } catch (error) {
          if (!(error instanceof GitCommandError)) throw error;
          logger.log('warn', 'skill commit failed', {
            projectId: project.id,
            skill: name,
            ...errorFields(error),
          });
          const identity = /tell me who you are|auto-detect email|empty ident/i.test(error.stderr);
          throw skillError(
            'git_failed',
            identity
              ? 'git could not commit: set user.name and user.email in your git config'
              : 'git could not commit the skill',
          );
        }
        const commit = (await run(root, ['rev-parse', 'HEAD'])).stdout.trim();
        logger.log('info', 'skill committed', { projectId: project.id, skill: name, verb });
        return { name, commit, branch };
      });
    },
  };
}
