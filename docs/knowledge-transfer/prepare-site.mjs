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
