import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveProblems, BIN_FILE } from './packCheck.js';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'pack-check-'));
try {
  execFileSync('pnpm', ['pack', '--pack-destination', work], {
    cwd: packageDir,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const archive = join(work, readdirSync(work)[0] as string);
  const paths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .split('\n')
    .filter((path) => path !== '' && !path.endsWith('/'));
  // A missing entry point is reported by archiveProblems, not by tar.
  const entry = paths.includes(`package/${BIN_FILE}`)
    ? execFileSync('tar', ['-xzOf', archive, `package/${BIN_FILE}`], {
        encoding: 'utf8',
      })
    : undefined;
  const problems = archiveProblems(paths, entry?.split('\n')[0]);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`${paths.length} files in the archive, all as the spec lists.`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
