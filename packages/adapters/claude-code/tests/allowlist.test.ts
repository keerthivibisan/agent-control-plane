import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyRelative, resolveAllowedTranscriptSync } from '../src/allowlist.js';
import { isPathInside } from '../src/paths.js';
import { makeTempDir, put, PROJECT_DIR, SID_1, SID_2 } from './helpers/temp-claude-dir.js';

describe('path containment (segment-wise)', () => {
  it('accepts the root itself and descendants', () => {
    expect(isPathInside('/repo', '/repo')).toBe(true);
    expect(isPathInside('/repo/', '/repo')).toBe(true);
    expect(isPathInside('/repo/packages/a', '/repo')).toBe(true);
    expect(isPathInside('/repo/a', '/repo/')).toBe(true);
  });

  it('rejects siblings with a shared prefix, parents, traversal, and relative paths', () => {
    expect(isPathInside('/repo-evil', '/repo')).toBe(false);
    expect(isPathInside('/repoX/a', '/repo')).toBe(false);
    expect(isPathInside('/', '/repo')).toBe(false);
    expect(isPathInside('/repo/../etc', '/repo')).toBe(false);
    expect(isPathInside('repo/a', '/repo')).toBe(false);
    expect(isPathInside('/repo/a', 'repo')).toBe(false);
  });
});

describe('allowlist classification (provider-adapters §3)', () => {
  it('accepts exactly the three allowlisted shapes', () => {
    expect(classifyRelative(`${PROJECT_DIR}/${SID_1}.jsonl`)).toEqual({
      kind: 'transcript',
      projectDir: PROJECT_DIR,
      sessionId: SID_1,
      agentId: null,
    });
    expect(classifyRelative(`${PROJECT_DIR}/${SID_1}/subagents/agent-a1B2.jsonl`)).toEqual({
      kind: 'subagent-transcript',
      projectDir: PROJECT_DIR,
      sessionId: SID_1,
      agentId: 'a1B2',
    });
    expect(classifyRelative(`${PROJECT_DIR}/${SID_1}/subagents/agent-a1B2.meta.json`)).toEqual({
      kind: 'subagent-meta',
      projectDir: PROJECT_DIR,
      sessionId: SID_1,
      agentId: 'a1B2',
    });
  });

  it.each([
    `${PROJECT_DIR}/history.jsonl`,
    `${PROJECT_DIR}/settings.json`,
    `${PROJECT_DIR}/custom-title.json`,
    `${PROJECT_DIR}/${SID_1}.jsonl.orphaned-1700000000`,
    `${PROJECT_DIR}/${SID_1}.orphaned-1700000000.jsonl`,
    `${PROJECT_DIR}/${SID_1}.superseded-2.jsonl`,
    `${PROJECT_DIR}/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.jsonl`,
    `${PROJECT_DIR}/not-a-uuid.jsonl`,
    `${PROJECT_DIR}/memory/${SID_1}.jsonl`,
    `${PROJECT_DIR}/${SID_1}/tool-results/${SID_2}.jsonl`,
    `${PROJECT_DIR}/${SID_1}/subagents/agent-a1.orphaned-1.jsonl`,
    `${PROJECT_DIR}/${SID_1}/subagents/agent-a-1.jsonl`,
    `${PROJECT_DIR}/${SID_1}/subagents/agent-.jsonl`,
    `${PROJECT_DIR}/${SID_1}/subagents/a1.jsonl`,
    `${PROJECT_DIR}/${SID_1}/subagents/nested/agent-a1.jsonl`,
    `${PROJECT_DIR}/${SID_1}/custom-title.json`,
    `../sessions/${SID_1}.jsonl`,
    `${SID_1}.jsonl`,
    `./${SID_1}.jsonl`,
    `..`,
  ])('denies %s', (relative) => {
    expect(classifyRelative(relative)).toBeNull();
  });
});

describe('resolveAllowedTranscriptSync (hook transcript_path)', () => {
  it('accepts allowlisted transcripts and rejects everything else', async () => {
    const root = await makeTempDir();
    const top = await put(root, `projects/${PROJECT_DIR}/${SID_1}.jsonl`, '{}\n');
    const sub = await put(root, `projects/${PROJECT_DIR}/${SID_1}/subagents/agent-a1.jsonl`, '');
    const meta = await put(
      root,
      `projects/${PROJECT_DIR}/${SID_1}/subagents/agent-a1.meta.json`,
      '{}',
    );
    const denied = await put(root, `projects/${PROJECT_DIR}/${SID_1}/tool-results/x.jsonl`, '');
    const sessions = await put(root, `sessions/${SID_2}.jsonl`, '');
    const outside = await put(root, `../${path.basename(root)}-outside/${SID_2}.jsonl`, '');
    const escape = path.join(root, `projects/${PROJECT_DIR}/${SID_2}.jsonl`);
    await symlink(outside, escape);
    const disguised = path.join(root, `projects/${PROJECT_DIR}/${SID_2.replace('2', '9')}.jsonl`);
    await symlink(denied, disguised);

    expect(resolveAllowedTranscriptSync(root, top)).toBe(top);
    expect(resolveAllowedTranscriptSync(root, sub)).toBe(sub);
    expect(resolveAllowedTranscriptSync(root, meta)).toBeNull();
    expect(resolveAllowedTranscriptSync(root, denied)).toBeNull();
    expect(resolveAllowedTranscriptSync(root, sessions)).toBeNull();
    expect(resolveAllowedTranscriptSync(root, outside)).toBeNull();
    expect(resolveAllowedTranscriptSync(root, escape)).toBeNull();
    expect(resolveAllowedTranscriptSync(root, disguised)).toBeNull();
    expect(resolveAllowedTranscriptSync(root, `projects/${PROJECT_DIR}/${SID_1}.jsonl`)).toBeNull();
    expect(
      resolveAllowedTranscriptSync(root, path.join(root, `projects/x/${SID_1}.jsonl`)),
    ).toBeNull();
    expect(
      resolveAllowedTranscriptSync(
        root,
        `${root}/projects/${PROJECT_DIR}/../${PROJECT_DIR}/${SID_1}.jsonl`,
      ),
    ).toBe(top);
  });

  it('returns null when the projects directory does not exist', async () => {
    const root = await makeTempDir();
    await mkdir(path.join(root, 'other'));
    expect(
      resolveAllowedTranscriptSync(root, path.join(root, `projects/a/${SID_1}.jsonl`)),
    ).toBeNull();
  });
});
