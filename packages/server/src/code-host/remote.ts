import type { CodeHostProvider } from '@acp/core/api';

/**
 * The project's `origin` URL → the host and `owner/name` (ADR-0025 §1). Pure. The URL itself is
 * never returned, stored or logged: it can hold a user name or a token (`https://user:token@…`).
 * Recognised forms: `git@host:owner/name(.git)`, `ssh://[user@]host[:port]/owner/name(.git)`,
 * `https://[user[:password]@]host[:port]/owner/name(.git)(/)` and `git://host/owner/name(.git)`.
 */

export interface RemoteRepo {
  /** Lowercase host name, e.g. `github.com`. */
  host: string;
  owner: string;
  name: string;
}

/** GitHub's owner rule: letters, digits and single hyphens, at most 39 characters. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
/** GitHub's repository names: letters, digits, `.`, `_`, `-`; never `.` or `..`. */
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;

function fromPath(host: string, path: string): RemoteRepo | null {
  const parts = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts as [string, string];
  const h = host.toLowerCase();
  if (!HOST.test(h) || !OWNER.test(owner) || !NAME.test(name)) return null;
  if (name === '.' || name === '..') return null;
  return { host: h, owner, name };
}

export function parseRemoteUrl(url: string): RemoteRepo | null {
  const text = url.trim();
  if (text.length === 0 || text.length > 2048 || /[\s\0]/.test(text)) return null;
  // scp-like `[user@]host:owner/name`: no scheme, and a `:` before the first `/`.
  const scp = /^(?:[^@/:]+@)?([^@/:]+):(?!\/)(.+)$/.exec(text);
  if (scp?.[1] !== undefined && scp[2] !== undefined && !text.includes('://')) {
    return fromPath(scp[1], scp[2]);
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (!['https:', 'http:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:'].includes(parsed.protocol)) {
    return null;
  }
  if (parsed.search !== '' || parsed.hash !== '') return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  return fromPath(parsed.hostname, path);
}

/** Hosts the GitHub provider serves (ssh over 443 uses `ssh.github.com`). */
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com', 'ssh.github.com']);

export function providerOf(remote: RemoteRepo): CodeHostProvider | null {
  return GITHUB_HOSTS.has(remote.host) ? 'github' : null;
}

/** `owner/name`, the only form of the repository the app shows or passes to the CLI. */
export const repoSlug = (remote: RemoteRepo): string => `${remote.owner}/${remote.name}`;
