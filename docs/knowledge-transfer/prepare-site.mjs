/** Refresh the public artifact from the explicit, reviewed KT sources only. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const notes = join(root, 'site', 'notes');
await mkdir(notes, { recursive: true });
const files = [
  'README.md',
  'ENGINE.md',
  'WORKFLOWS.md',
  'CONFLICTS.md',
  'TOKENS.md',
  'ISSUES.md',
  'FUTURE.md',
  'EVIDENCE.md',
  'PUBLISHING.md',
  'LINKEDIN.md',
  'COMPLETION.md',
  'pages-workflow.example.yml',
];
for (const file of files) {
  if (file === 'README.md') {
    const markdown = await readFile(join(root, file), 'utf8');
    await writeFile(
      join(notes, file),
      markdown.replaceAll('](site/index.html)', '](../index.html)'),
    );
  } else {
    await copyFile(join(root, file), join(notes, file));
  }
}
for (const file of ['architecture.mmd', 'helper-authorization.mmd']) {
  await copyFile(join(root, 'diagrams', file), join(root, 'site', 'assets', file));
}

// Reuse the repository brand assets byte-for-byte in the standalone artifact.
await copyFile(
  join(root, '..', 'brand', 'control-plane-logo-on-dark.svg'),
  join(root, 'site', 'assets', 'acp-logo-on-dark.svg'),
);
await copyFile(
  join(root, '..', 'brand', 'favicon.svg'),
  join(root, 'site', 'assets', 'favicon.svg'),
);

// Match the app's dark-theme accent while preserving the repository's original brand assets.
for (const [source, destination] of [
  ['control-plane-logo-on-dark.svg', 'acp-logo-blue.svg'],
  ['favicon.svg', 'favicon-blue.svg'],
]) {
  const svg = await readFile(join(root, '..', 'brand', source), 'utf8');
  await writeFile(join(root, 'site', 'assets', destination), svg.replaceAll('#D8FF64', '#1F6FEB'));
}
