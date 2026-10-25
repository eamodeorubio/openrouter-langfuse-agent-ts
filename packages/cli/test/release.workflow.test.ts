import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const WORKFLOW = new URL('../../../.github/workflows/ci.yml', import.meta.url);
const RELEASED = "needs.release.outputs.released == 'true'";

/** The text of the job called `name`, from its header to the next job or the end. */
const jobText = (text: string, name: string): string => {
  const start = text.indexOf(`\n  ${name}:\n`);
  expect(start, `no job ${name}`).toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
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

  it('is the only job that publishes, holds the token or asks for an identity token', async () => {
    const { text, publish } = await load();
    expect(text.match(/NPM_TOKEN/g)).toHaveLength(1);
    expect(publish).toContain('NPM_TOKEN');
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

  it('gives the token to the publish step alone', async () => {
    const { publish } = await load();
    const withToken = stepsOf(publish).filter((step) =>
      step.includes('NPM_TOKEN'),
    );
    expect(withToken).toHaveLength(1);
    expect(withToken[0]).toMatch(/run: pnpm .*\bpublish\b/);
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
