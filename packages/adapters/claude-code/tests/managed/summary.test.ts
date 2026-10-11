import { describe, expect, it } from 'vitest';
import { AsyncQueue } from '../../src/managed/queue.js';
import {
  commandName,
  isInside,
  MAX_SUMMARY_LENGTH,
  summarizeToolUse,
} from '../../src/managed/summary.js';

const CWD = '/work/project';

describe('P3-B summarizeToolUse (content-free, ≤200 chars, redacted)', () => {
  it('shows the tool and its target path, relative inside the directory', () => {
    expect(summarizeToolUse('Edit', { file_path: '/work/project/src/a.ts' }, CWD)).toBe(
      'Edit src/a.ts',
    );
    expect(summarizeToolUse('Write', { file_path: 'b.ts', content: 'SECRET' }, CWD)).toBe(
      'Write b.ts',
    );
    expect(summarizeToolUse('NotebookEdit', { notebook_path: 'n.ipynb' }, CWD)).toBe(
      'NotebookEdit n.ipynb',
    );
    expect(summarizeToolUse('Glob', { pattern: '**/*', path: CWD }, CWD)).toBe('Glob .');
    expect(summarizeToolUse('Read', { file_path: '/etc/hosts' }, CWD)).toBe('Read /etc/hosts');
  });

  it('never includes other input fields', () => {
    const s = summarizeToolUse(
      'Agent',
      { prompt: 'SECRET', description: 'SECRET', subagent_type: 'SECRET' },
      CWD,
    );
    expect(s).toBe('Agent');
    expect(summarizeToolUse('Grep', { pattern: 'SECRET' }, CWD)).toBe('Grep');
  });

  it('shows only the command name of a shell call', () => {
    expect(summarizeToolUse('Bash', { command: 'git commit -m "SECRET"' }, CWD)).toBe('Bash git');
    expect(summarizeToolUse('Bash', { command: '$(SECRET) && rm -rf /' }, CWD)).toBe('Bash');
    expect(summarizeToolUse('Bash', {}, CWD)).toBe('Bash');
  });

  it('caps at 200 characters and redacts secrets in paths', () => {
    const long = summarizeToolUse('Write', { file_path: `${'d/'.repeat(300)}f.ts` }, CWD);
    expect(Array.from(long).length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
    const secret = summarizeToolUse(
      'Write',
      { file_path: 'keys/sk-ant-abcdefghijkl0123.txt' },
      CWD,
    );
    expect(secret).not.toContain('sk-ant-');
    expect(secret).toContain('[REDACTED]');
  });

  it('replaces an odd tool name and strips control characters', () => {
    expect(summarizeToolUse('Bad name\n', {}, CWD)).toBe('Unknown tool');
    expect(summarizeToolUse('Edit', { file_path: 'a\nb.ts' }, CWD)).toBe('Edit a b.ts');
    expect(summarizeToolUse('Edit', 'not an object', CWD)).toBe('Edit');
  });
});

describe('P3-B commandName and isInside', () => {
  it('skips env assignments and reduces paths to the basename', () => {
    expect(commandName('A=1 B=2 /usr/local/bin/pnpm test')).toBe('pnpm');
    expect(commandName('  ls   -la ')).toBe('ls');
    expect(commandName('A=1')).toBeNull();
    expect(commandName('"quoted" x')).toBeNull();
    expect(commandName(42)).toBeNull();
  });

  it('is lexical containment', () => {
    expect(isInside('/work/project', CWD)).toBe(true);
    expect(isInside('/work/project/a/b', CWD)).toBe(true);
    expect(isInside('/work/project-2/a', CWD)).toBe(false);
    expect(isInside('/work/project/../x', CWD)).toBe(false);
  });
});

describe('P3-B AsyncQueue', () => {
  it('delivers pushed items in order, then ends after close', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    const out: number[] = [];
    const reading = (async () => {
      for await (const n of q) out.push(n);
    })();
    q.push(2);
    q.close();
    expect(q.push(3)).toBe(false);
    await reading;
    expect(out).toEqual([1, 2]);
  });

  it('allows a single consumer only', () => {
    const q = new AsyncQueue<number>();
    q[Symbol.asyncIterator]();
    expect(() => q[Symbol.asyncIterator]()).toThrow('single consumer');
  });
});
