import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const WORKFLOW = new URL('../../../.github/workflows/ci.yml', import.meta.url);
const RELEASED = "needs.release.outputs.released == 'true'";

/** The code of the job called `name`, from its header to the next job or the end, without comments. */
const jobText = (text: string, name: string): string => {
  const start = text.indexOf(`\n  ${name}:\n`);
  expect(start, `no job ${name}`).toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  const job = next === -1 ? rest : rest.slice(0, next + 1);
  // The comments explain the job; only its code is checked.
  return job
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
};

const stepsOf = (job: string): string[] => job.split(/\n {6}- /).slice(1);

const load = async () => {
  const text = await readFile(WORKFLOW, 'utf8');
  return {
    text,
    release: jobText(text, 'release'),
    publish: jobText(text, 'publish'),
  };
};

describe('the release job', () => {
  it('lets Release Please say whether it created a release, and which tag', async () => {
    const { release } = await load();
    expect(release).toContain('googleapis/release-please-action');
    expect(release).toMatch(/id: release\b/);
    expect(release).toContain(
      "released: ${{ steps.release.outputs['packages/cli--release_created'] }}",
    );
    expect(release).toContain(
      "tag: ${{ steps.release.outputs['packages/cli--tag_name'] }}",
    );
  });

  it('never holds the npm token or an identity token', async () => {
    const { release } = await load();
    expect(release).not.toMatch(/NPM_TOKEN|id-token|publish/);
  });
});

describe('the publish job', () => {
  it('runs after the release job, and only when it created a release', async () => {
    const { publish } = await load();
    expect(publish).toContain('needs: release');
    expect(publish).toMatch(
      new RegExp(
        `\\n {4}if: \\$\\{\\{ ${RELEASED.replaceAll('.', '\\.')} \\}\\}\\n`,
      ),
    );
  });

  it('is the only job that publishes or asks for an identity token', async () => {
    const { text, publish } = await load();
    expect(text.match(/id-token: write/g)).toHaveLength(1);
    expect(publish).toContain('id-token: write');
    expect(text.match(/\bpublish\b/g)?.length).toBeGreaterThan(0);
    for (const name of ['check', 'mutation', 'release']) {
      expect(jobText(text, name), name).not.toMatch(/pnpm .*\bpublish\b/);
    }
  });

  it('keeps the repository read-only and drops the git credentials', async () => {
    const { publish } = await load();
    expect(publish).toContain('contents: read');
    expect(publish).not.toMatch(/contents: write|pull-requests: write/);
    expect(publish).toContain('persist-credentials: false');
    expect(publish).toContain('ref: ${{ needs.release.outputs.tag }}');
  });

  it('keeps no npm token anywhere: trusted publishing signs in with the identity token', async () => {
    const { text, publish } = await load();
    expect(text).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
    // Whatever name a token has, the job reads no secret and writes no token to .npmrc.
    expect(publish).not.toMatch(/secrets\.|_authToken/);
  });

  it('checks the archive before it publishes', async () => {
    const steps = stepsOf((await load()).publish);
    const check = steps.findIndex((step) => step.includes('pack:check'));
    const publish = steps.findIndex((step) =>
      /run: pnpm .*\bpublish\b/.test(step),
    );
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(publish);
  });
});

describe('the Release Please configuration', () => {
  it('no longer forces a version or treats the project as below 1.0', async () => {
    const config = JSON.parse(
      await readFile(
        new URL('../../../release-please-config.json', import.meta.url),
        'utf8',
      ),
    ) as { packages: Record<string, Record<string, unknown>> };
    const options = config.packages['packages/cli'] ?? {};
    expect(options).not.toHaveProperty('release-as');
    expect(options).not.toHaveProperty('bump-minor-pre-major');
    expect(options).not.toHaveProperty('bump-patch-for-minor-pre-major');
  });
});
