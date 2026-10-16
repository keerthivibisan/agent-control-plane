import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_SKILL_BYTES, MAX_SKILL_DESCRIPTION, SKILL_FILE, SkillNameSchema } from '@acp/core';
import { SKILLS_PLUGIN_NAME } from '@acp/orchestrator';
import { isSafeId } from '../workspace/index.js';
import { projectSkillsDir, skillFileIn, type SkillPathOptions } from './skill-files.js';

/**
 * The run-scoped skills plugin (ADR-0019 §4 as amended, decision E). Managed agents run with
 * `settingSources: []`, so Claude Code loads no skills from the file system; the server copies the
 * skills a stage maps into `<dataDir>/runs/<runId>/skills-plugin/`, a local plugin named
 * `acp-skills`, and the adapter passes it with only those skills allowed.
 *
 * - Skills are copied from the **project's checkout** (never an agent worktree), under the path
 *   rules of `skill-files.ts`, and read without following a symlink (`O_NOFOLLOW`).
 * - The front matter is reduced to `name` (the folder's slug) and `description`: anything else a
 *   skill declares (`allowed-tools`, hooks, model) is dropped, so a skill can never widen an
 *   agent's tools. The plugin holds nothing but `.claude-plugin/plugin.json` and `skills/`: no
 *   hooks, `.mcp.json`, `agents/` or settings.
 * - A skill that is missing, refused, too large or not UTF-8 text is left out; the agent starts
 *   without it (ADR-0019 §4).
 * - Files are written to a temporary name and renamed, so an agent never reads half a file.
 */

export interface SkillsPluginDeps {
  dataDir: string;
  skills?: SkillPathOptions;
}

export interface BuiltSkillsPlugin {
  /** The plugin directory for `ManagedAgentSpec.skillPlugin.path`. */
  path: string;
  /** Bare names of the skills that were copied, in the order asked. */
  skills: string[];
  /** Bare names that were asked for but left out. */
  refused: string[];
}

export interface SkillsPlugins {
  build(input: {
    runId: string;
    projectRoot: string;
    skills: readonly string[];
  }): Promise<BuiltSkillsPlugin>;
  /** Removes the run's plugin directory (the run ended). Idempotent. */
  remove(runId: string): Promise<void>;
  /** On start: no agent is live, so every run's plugin directory is removed. Returns how many. */
  cleanupAll(): Promise<number>;
}

const RUNS_DIR = 'runs';
const PLUGIN_DIR = 'skills-plugin';

export function createSkillsPlugins(deps: SkillsPluginDeps): SkillsPlugins {
  const runsRoot = join(deps.dataDir, RUNS_DIR);

  function pluginDir(runId: string): string {
    if (!isSafeId(runId)) throw new Error('unsafe run id for the skills plugin');
    return join(runsRoot, runId, PLUGIN_DIR);
  }

  async function writeAtomic(path: string, text: string): Promise<void> {
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, text, { flag: 'wx', mode: 0o600 });
    try {
      await rename(temp, path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async function removeRun(runId: string): Promise<void> {
    await rm(pluginDir(runId), { recursive: true, force: true });
    try {
      // The run folder may hold other files later; it goes only when empty.
      await rmdir(join(runsRoot, runId));
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error;
    }
  }

  return {
    async build({ runId, projectRoot, skills }) {
      const path = pluginDir(runId);
      await mkdir(join(path, '.claude-plugin'), { recursive: true, mode: 0o700 });
      await writeAtomic(
        join(path, '.claude-plugin', 'plugin.json'),
        `${JSON.stringify({ name: SKILLS_PLUGIN_NAME })}\n`,
      );
      const source = await projectSkillsDir(projectRoot, deps.skills);
      const copied: string[] = [];
      const refused: string[] = [];
      for (const name of new Set(skills)) {
        const file = source === null ? null : await skillFileIn(source, name);
        const text = file === null ? null : await readSkillFile(file);
        if (text === null || !SkillNameSchema.safeParse(name).success) {
          refused.push(name);
          continue;
        }
        const target = join(path, 'skills', name);
        await mkdir(target, { recursive: true, mode: 0o700 });
        await writeAtomic(join(target, SKILL_FILE), reducedSkill(name, text));
        copied.push(name);
      }
      return { path, skills: copied, refused };
    },

    remove: removeRun,

    async cleanupAll() {
      let entries;
      try {
        entries = await readdir(runsRoot, { withFileTypes: true });
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') return 0;
        throw error;
      }
      let removed = 0;
      for (const entry of entries) {
        // Anything this module would not have created is left alone.
        if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
        await removeRun(entry.name);
        removed++;
      }
      return removed;
    },
  };
}

/** The file's UTF-8 text, or null when it is too large, not UTF-8, or a symlink. */
async function readSkillFile(path: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    // A symlink swapped in after the checks (ELOOP), or the file went away.
    return null;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) return null;
    const bytes = await handle.readFile();
    if (bytes.length > MAX_SKILL_BYTES) return null;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  } finally {
    await handle.close();
  }
}

const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits a SKILL.md into its front matter's `description` and the Markdown body. */
export function parseSkillFile(text: string): { description: string; body: string } {
  const match = FRONT_MATTER.exec(text);
  if (match === null) return { description: '', body: text };
  const lines = (match[1] ?? '').split(/\r?\n/);
  return { description: descriptionOf(lines), body: text.slice(match[0].length) };
}

/** A SKILL.md with only `name` and `description` in its front matter. */
export function reducedSkill(name: string, text: string): string {
  const { description, body } = parseSkillFile(text);
  // A JSON string is a valid YAML double-quoted scalar, so any text stays one value.
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n${body}`;
}

/** The `description` value: a plain, quoted or block scalar on one key (no full YAML). */
function descriptionOf(lines: readonly string[]): string {
  const index = lines.findIndex((l) => /^description\s*:/.test(l));
  if (index === -1) return '';
  const first = (lines[index] ?? '').replace(/^description\s*:/, '').trim();
  const following: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (line.trim() !== '' && !/^\s/.test(line)) break;
    following.push(line);
  }
  let value: string;
  if (/^[|>][+-]?$/.test(first)) {
    const indented = following.filter((l) => l.trim() !== '');
    const indent = Math.min(...indented.map((l) => l.length - l.trimStart().length));
    const body = following.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
    value = first.startsWith('|') ? body.join('\n') : body.map((l) => l.trim()).join(' ');
  } else if (first.startsWith('"')) {
    value = unquoteDouble(first);
  } else if (first.startsWith("'")) {
    value = first.replace(/^'|'$/g, '').replace(/''/g, "'");
  } else {
    value = [first, ...following.map((l) => l.trim())].filter((l) => l !== '').join(' ');
  }
  return value.replace(/\s+$/g, '').trim().slice(0, MAX_SKILL_DESCRIPTION);
}

function unquoteDouble(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'string') return parsed;
  } catch {
    // Not JSON-compatible: drop the quotes only.
  }
  return text.replace(/^"|"$/g, '');
}
