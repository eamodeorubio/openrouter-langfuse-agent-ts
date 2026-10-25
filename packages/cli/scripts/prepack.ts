import { copyFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const here = new URL('../', import.meta.url);

// The README and the licence live at the root of the repository, once. They
// are copied in when the archive is made, and git ignores the copies.
for (const file of ['README.md', 'LICENSE']) {
  await copyFile(new URL(file, root), new URL(file, here));
}
