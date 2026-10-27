import { rmSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGitRunner } from '../../../src/workspace/index.js';
import { GIT_ENV, makeTempDir } from './harness.js';

it('the verification server can commit in a new repo without global or system git identity', async () => {
  const root = makeTempDir('acp-verification-git-');
  const run = createGitRunner({ env: GIT_ENV });
  const options = { cwd: root };
  try {
    await run(['init', '--quiet', '-b', 'main'], options);
    // No local identity is configured, as with repositories made by the project wizard.
    await expect(run(['config', '--local', '--get', 'user.name'], options)).rejects.toThrow();
    expect(GIT_ENV.GIT_CONFIG_GLOBAL).toBe('/dev/null');
    expect(GIT_ENV.GIT_CONFIG_NOSYSTEM).toBe('1');
    await run(
      ['commit', '--quiet', '--allow-empty', '-m', 'Synthetic verification commit'],
      options,
    );
    const result = await run(['log', '-1', '--format=%an <%ae>|%cn <%ce>'], options);
    expect(result.stdout.trim()).toBe(
      'Test Owner <owner@example.invalid>|Test Owner <owner@example.invalid>',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
