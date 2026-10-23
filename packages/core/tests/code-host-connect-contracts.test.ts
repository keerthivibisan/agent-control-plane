// Contract tests for connecting a project to GitHub from Settings (ADR-0025 §7, v0.3.0 G-E).
// Synthetic names only.
import { describe, expect, it } from 'vitest';
import {
  ConnectRepositoryRequestSchema,
  CreateRepositoryRequestSchema,
  gitHubRemoteUrl,
  parseGitHubRepository,
} from '../src/api/index.js';

describe('parseGitHubRepository', () => {
  it('reads owner/name, an https address and an ssh address', () => {
    expect(parseGitHubRepository('octo-org/acp-git-test')).toEqual({
      owner: 'octo-org',
      name: 'acp-git-test',
      protocol: 'https',
    });
    expect(parseGitHubRepository('https://github.com/octo/acp.git')).toMatchObject({
      owner: 'octo',
      name: 'acp',
      protocol: 'https',
    });
    expect(parseGitHubRepository('https://github.com/octo/acp/')).toMatchObject({ name: 'acp' });
    expect(parseGitHubRepository('git@github.com:octo/acp.git')).toMatchObject({
      protocol: 'ssh',
    });
  });

  it('refuses other hosts, users, ports, paths, queries and odd names', () => {
    for (const bad of [
      'https://gitlab.com/octo/acp',
      'https://user:pw@github.com/octo/acp',
      'https://github.com:8443/octo/acp',
      'https://github.com/octo/acp/tree/main',
      'https://github.com/octo/acp?x=1',
      'http://github.com/octo/acp',
      'octo/acp/extra',
      '-octo/acp',
      'octo/..',
      'octo/a b',
      'octo/acp; rm -rf /',
      'ext::sh -c touch% /tmp/x',
      '--upload-pack=x/acp',
    ]) {
      expect(parseGitHubRepository(bad), bad).toBeNull();
    }
  });

  it('writes the origin address in the chosen form', () => {
    expect(gitHubRemoteUrl({ owner: 'octo', name: 'acp', protocol: 'https' })).toBe(
      'https://github.com/octo/acp.git',
    );
    expect(gitHubRemoteUrl({ owner: 'octo', name: 'acp', protocol: 'ssh' })).toBe(
      'git@github.com:octo/acp.git',
    );
  });
});

describe('the requests', () => {
  it('creates with a valid name, an optional owner and a visibility', () => {
    expect(
      CreateRepositoryRequestSchema.parse({
        name: 'acp-git-test',
        visibility: 'private',
        push: true,
      }),
    ).toMatchObject({ name: 'acp-git-test' });
    for (const name of ['', '.', '..', 'x.git', 'a/b', 'a b', '-'.repeat(101)]) {
      expect(
        CreateRepositoryRequestSchema.safeParse({ name, visibility: 'private', push: false })
          .success,
        name,
      ).toBe(false);
    }
    expect(
      CreateRepositoryRequestSchema.safeParse({
        name: 'ok',
        owner: '-bad',
        visibility: 'public',
        push: false,
      }).success,
    ).toBe(false);
  });

  it('connects with text the parser then reads', () => {
    expect(ConnectRepositoryRequestSchema.parse({ repository: ' octo/acp ' }).repository).toBe(
      'octo/acp',
    );
  });
});
