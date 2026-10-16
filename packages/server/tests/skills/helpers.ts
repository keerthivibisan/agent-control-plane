import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defaultProjectWorkflow, type ProjectWorkflow, type SkillName } from '@acp/core';
import type { LogFields, Logger } from '../../src/logger.js';
import {
  createAgentsService,
  createSkillsService,
  type SkillProject,
} from '../../src/skills/index.js';
import { execFile } from 'node:child_process';
import { GIT_TEST_ENV, makeRepo, tempDir, type ExecCall } from '../workspace/helpers.js';
import { createGitRunner, type ExecFileFn } from '../../src/workspace/index.js';

/**
 * Skills tests run against throwaway `git init` repositories in temp dirs (never a real project
 * and never `~/.claude`). The product's git runner gets a fixed identity through the environment,
 * as an owner's git config would give it.
 */

export const SKILLS_NOW = new Date('2026-10-16T09:00:00.000Z');

export const GIT_IDENTITY_ENV: Readonly<Record<string, string>> = {
  ...GIT_TEST_ENV,
  GIT_AUTHOR_NAME: 'Test Owner',
  GIT_AUTHOR_EMAIL: 'owner@example.invalid',
  GIT_COMMITTER_NAME: 'Test Owner',
  GIT_COMMITTER_EMAIL: 'owner@example.invalid',
};

export interface LogLine {
  level: string;
  message: string;
  fields: LogFields | undefined;
}

export function captureLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  return {
    logger: { log: (level, message, fields) => lines.push({ level, message, fields }) },
    lines,
  };
}

/** A workflow mapping `skill` to the given stages. */
export function workflowUsing(
  projectId: string,
  skill: SkillName,
  stages: ('plan' | 'helpers' | 'code-review')[],
): ProjectWorkflow {
  const w = defaultProjectWorkflow(projectId, SKILLS_NOW.toISOString());
  if (stages.includes('plan')) w.stages.plan.skill = skill;
  if (stages.includes('helpers')) w.stages.helpers.skill = skill;
  if (stages.includes('code-review'))
    w.stages['code-review'] = { enabled: true, model: null, skill };
  return w;
}

export function setupSkills(
  options: { files?: Record<string, string>; workflow?: ProjectWorkflow } = {},
) {
  const root = makeRepo(options.files ?? { 'README.md': 'hello\n', 'src/app.ts': 'export {};\n' });
  const project: SkillProject = { id: 'p1', rootPath: root };
  // Every process the service starts is recorded, so tests can assert it is only ever argv git.
  const calls: ExecCall[] = [];
  const spyExec: ExecFileFn = (file, args, opts, callback) => {
    calls.push({ file, args: [...args], options: opts });
    execFile(file, args, opts, callback);
  };
  const git = createGitRunner({ execFile: spyExec, env: GIT_IDENTITY_ENV });
  const { logger, lines } = captureLogger();
  const state = {
    workflow: options.workflow ?? defaultProjectWorkflow('p1', SKILLS_NOW.toISOString()),
  };
  // A stand-in home folder: the real one (and its ~/.claude) is never consulted.
  const homeDir = tempDir('acp-skills-home-');
  const skills = createSkillsService({
    homeDir,
    git,
    now: () => SKILLS_NOW,
    workflowOf: () => state.workflow,
    logger,
  });
  const agents = createAgentsService({
    homeDir,
    git,
    logger,
    workflowOf: () => state.workflow,
  });
  return { root, project, skills, agents, logs: lines, state, calls, homeDir };
}

/** Every file under `root` (except `.git`) with its content, for "nothing else touched" checks. */
export function snapshot(root: string, except: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(root, full);
      if (rel === '.git' || except.some((e) => rel === e || rel.startsWith(`${e}/`))) continue;
      const stats = lstatSync(full);
      if (stats.isSymbolicLink()) out[rel] = 'symlink';
      else if (stats.isDirectory()) walk(full);
      else out[rel] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return out;
}

export function body(name: string, instructions = `# ${name}\n\nDo the thing.\n`) {
  return { name, description: `Use ${name} when needed`, instructions };
}
