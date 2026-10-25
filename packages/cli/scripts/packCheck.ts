/** The name of the package and of its command. */
export const PACKAGE_NAME = 'ask-openrouter';

/** The file the command runs, from the root of the package. */
export const BIN_FILE = 'dist/index.js';

const isText = (value: unknown): boolean =>
  typeof value === 'string' && value.trim() !== '';

/** A text, or an object whose `url` is one: the two forms npm accepts. */
const hasUrl = (value: unknown): boolean =>
  isText(value) || isText((value as { url?: unknown } | null)?.url);

/** What stops this manifest from being published as the spec describes. Empty when nothing does. */
export const manifestProblems = (
  manifest: Record<string, unknown>,
): string[] => {
  const problems: string[] = [];
  const need = (ok: boolean, problem: string) => {
    if (!ok) {
      problems.push(problem);
    }
  };
  const publishConfig = (manifest.publishConfig ?? {}) as Record<
    string,
    unknown
  >;
  const bin = (manifest.bin ?? {}) as Record<string, unknown>;
  const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
  const files = manifest.files;

  need(manifest.name === PACKAGE_NAME, `name must be ${PACKAGE_NAME}`);
  need(manifest.private !== true, 'the package is private');
  need(
    bin[PACKAGE_NAME] === BIN_FILE && Object.keys(bin).length === 1,
    `bin must be exactly { "${PACKAGE_NAME}": "${BIN_FILE}" }`,
  );
  need(
    Array.isArray(files) && files.length === 1 && files[0] === 'dist',
    'files must be exactly ["dist"]',
  );
  need(
    publishConfig.access === 'public',
    'publishConfig.access must be public',
  );
  need(
    publishConfig.provenance === true,
    'publishConfig.provenance must be true',
  );
  need(isText(manifest.license), 'license is missing');
  need(hasUrl(manifest.repository), 'repository is missing');
  need(hasUrl(manifest.bugs), 'bugs is missing');
  need(isText(manifest.homepage), 'homepage is missing');
  need(
    Array.isArray(manifest.keywords) && manifest.keywords.length > 0,
    'keywords are missing',
  );
  need(
    isText((manifest.engines as Record<string, unknown> | undefined)?.node),
    'engines.node is missing',
  );
  need(isText(scripts.prepack), 'scripts.prepack is missing');
  return problems;
};

/** The paths npm puts in every archive, besides `dist`. */
const FIXED = ['package/package.json', 'package/README.md', 'package/LICENSE'];

/**
 * What is wrong with the listing of an archive made by `pnpm pack`: a path the
 * spec does not allow, a required path that is missing, or an entry point that
 * does not start with a shebang. `firstLine` is the first line of the entry point.
 */
export const archiveProblems = (
  paths: string[],
  firstLine: string | undefined,
): string[] => {
  // Only compiled code goes under dist: not a source map, a build info file or a test.
  const allowed = (path: string) =>
    FIXED.includes(path) ||
    (path.startsWith('package/dist/') &&
      path.endsWith('.js') &&
      !path.split('/').some((part) => part.startsWith('.')));
  const problems = paths
    .filter((path) => !allowed(path))
    .map((path) => `${path} must not be in the archive`);
  for (const path of [...FIXED, `package/${BIN_FILE}`]) {
    if (!paths.includes(path)) {
      problems.push(`${path} is missing from the archive`);
    }
  }
  if (firstLine !== '#!/usr/bin/env node') {
    problems.push(
      `${BIN_FILE} must start with the shebang #!/usr/bin/env node`,
    );
  }
  return problems;
};
