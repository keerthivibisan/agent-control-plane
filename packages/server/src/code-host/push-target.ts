import { isAbsolute } from 'node:path';
import { GitCommandError, SAFE_GIT_CONFIG, type GitRunner } from '../workspace/index.js';
import { CodeHostError, MESSAGES } from './errors.js';
import { parseRemoteUrl } from './remote.js';

/**
 * Where the owner's pushes go (F-2, T-1's planted push URL). Every push the app makes for the
 * owner (Push & open PR, a new branch's push, the push after creating the repository, deleting a
 * ticket branch on origin) goes to `origin`'s configured address (`remote.origin.url`), passed to
 * `git push` as the address itself, never as the remote name. So a `remote.origin.pushurl` (which
 * a helper could plant in the repository's shared config, and which git would follow, even as an
 * extra address alongside the owner's own) is never used. A `url.<x>.pushInsteadOf` rule that
 * would rewrite that address for pushes only is refused: it can only send pushes somewhere other
 * than where the owner fetches from. `url.<x>.insteadOf` rules still apply, as they do to the
 * owner's own fetches (an ssh rewrite of GitHub addresses is common), so the push goes where
 * `git fetch origin` reads from. The address must be one the app recognises (`parseRemoteUrl`: an
 * `https`, `ssh`, `git` or scp-like `owner/name` address, or a local folder); `ext::` and `fd::`
 * transports are off for these pushes whatever the config says. The address is never logged or
 * shown.
 */

/** Prepended to the owner's pushes, after `SAFE_GIT_CONFIG`. */
export const PUSH_CONFIG: readonly string[] = [
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'protocol.fd.allow=never',
  '-c',
  'push.recurseSubmodules=no',
];

/** A local folder as an address: absolute, or `file://`; no control characters. */
function isLocalAddress(url: string): boolean {
  if ([...url].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return false;
  return (isAbsolute(url) && url.startsWith('/')) || url.startsWith('file:///');
}

/** `url.<base>.pushInsteadOf` values (`git config -z --get-regexp`); empty when there are none. */
async function pushRewrites(git: GitRunner, projectRoot: string): Promise<string[]> {
  try {
    const { stdout } = await git(
      [...SAFE_GIT_CONFIG, 'config', '-z', '--get-regexp', '^url\\..*\\.pushinsteadof$'],
      { cwd: projectRoot },
    );
    // Each entry is `key\nvalue\0`.
    return stdout
      .split('\0')
      .filter((entry) => entry !== '')
      .map((entry) => entry.slice(entry.indexOf('\n') + 1));
  } catch (error) {
    // Exit code 1: no such key.
    if (error instanceof GitCommandError) return [];
    throw error;
  }
}

/**
 * `origin`'s configured address, checked as above: the target of the owner's pushes. Refuses
 * (`CodeHostError`) when there is no `origin`, its address is not one the app recognises, or a
 * push-only rewrite would apply to it.
 */
export async function originPushUrl(git: GitRunner, projectRoot: string): Promise<string> {
  let url: string;
  try {
    const { stdout } = await git([...SAFE_GIT_CONFIG, 'config', '--get', 'remote.origin.url'], {
      cwd: projectRoot,
    });
    url = stdout.trim();
  } catch (error) {
    if (error instanceof GitCommandError) throw new CodeHostError('no_origin', MESSAGES.noOrigin);
    throw error;
  }
  if (url === '' || url.startsWith('-') || (parseRemoteUrl(url) === null && !isLocalAddress(url))) {
    throw new CodeHostError('push-rejected', MESSAGES.originAddressUnusable);
  }
  const rewrites = await pushRewrites(git, projectRoot);
  if (rewrites.some((prefix) => prefix !== '' && url.startsWith(prefix))) {
    throw new CodeHostError('push-rejected', MESSAGES.pushRewrite);
  }
  return url;
}
