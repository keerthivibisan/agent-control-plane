import { it } from 'vitest';

/**
 * A test that documents a gap the engine has TODAY (expected-failure policy,
 * docs/testing/adversarial.md): it passes while the body fails with a message carrying `[tag]`, and
 * fails (turns red) as soon as the body passes, so the fix that closes the gap has to turn it into
 * a plain `it`. Any other error still fails the test, which `it.fails` alone would hide. The same
 * wrapper as the server kit's (`packages/server/tests/adversarial/kit.ts`). Synthetic data only.
 */
export function knownGap(
  fix: 'F-1' | 'follow-up',
  tag: string,
  title: string,
  body: () => Promise<void> | void,
  timeout?: number,
): void {
  it(
    `[known gap, ${fix}] ${title}`,
    async () => {
      let failure: Error | undefined;
      try {
        await body();
      } catch (error) {
        failure = error instanceof Error ? error : new Error('a non-Error was thrown');
      }
      if (failure === undefined) {
        throw new Error(
          `This known gap (${fix}, [${tag}]) is closed now: make "${title}" a plain it() and ` +
            'update docs/testing/adversarial.md.',
        );
      }
      if (!failure.message.includes(`[${tag}]`)) throw failure;
      if (process.env['ACP_SHOW_KNOWN_GAPS'] === '1') {
        console.warn(`known gap (${fix}) ${title}:\n  ${failure.message.split('\n')[0] ?? ''}`);
      }
    },
    timeout,
  );
}
