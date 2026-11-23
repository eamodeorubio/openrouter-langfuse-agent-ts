import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const github = new URL('../../../.github/', import.meta.url);
const read = (file: string) => fs.readFileSync(new URL(file, github), 'utf8');

const GATE = 'workflows/eval-gate.yml';
const text = read(GATE);

interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}
interface Job {
  name?: string;
  needs?: string;
  if?: string;
  environment?: string;
  permissions?: Record<string, string>;
  'timeout-minutes'?: number;
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: Step[];
}
const workflow = parse(text) as {
  on: Record<string, { types?: string[] }>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};
const changes = workflow.jobs.changes as Job;
const gate = workflow.jobs['eval-gate'] as Job;

const step = (job: Job, name: RegExp): Step => {
  const found = job.steps.find((candidate) => name.test(candidate.name ?? ''));
  expect(found, `no step ${name}`).toBeDefined();
  return found as Step;
};

/** The step of a job that uses an action, whatever its version. */
const using = (job: Job, action: string): Step => {
  const found = job.steps.find((candidate) =>
    candidate.uses?.startsWith(`${action}@`),
  );
  expect(found, `no step that uses ${action}`).toBeDefined();
  return found as Step;
};

/** The lines of a file without comments, which explain the code and are not part of it. */
const code = (source: string) =>
  source
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

const SECRET = 'secrets.OPENROUTER_API_KEY';

describe('the triggers of the eval gate workflow', () => {
  it('runs on pull_request, opened, synchronize and reopened, and on no other event', () => {
    expect(Object.keys(workflow.on)).toEqual(['pull_request']);
    expect(workflow.on.pull_request?.types).toEqual([
      'opened',
      'synchronize',
      'reopened',
    ]);
  });

  it('never uses pull_request_target, which would run the code of a fork with the key', () => {
    expect(code(text)).not.toContain('pull_request_target');
  });

  it('lets a new push cancel the run of the same pull request, and only that one', () => {
    expect(workflow.concurrency.group).toBe(
      `eval-gate-\${{ github.event.pull_request.number }}`,
    );
    expect(workflow.concurrency['cancel-in-progress']).toBe(true);
  });
});

describe('the filter job', () => {
  it('names no environment and no secret, and may only read the pull request and the repository', () => {
    expect(changes.environment).toBeUndefined();
    expect(code(JSON.stringify(changes))).not.toContain('secrets.');
    expect(changes.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
    });
  });

  it('matches the changed files against .github/eval-gate-paths.yml, with an action pinned to a commit', () => {
    const matching = using(changes, 'dorny/paths-filter');
    expect(matching.uses).toMatch(/^dorny\/paths-filter@[0-9a-f]{40}$/);
    expect(matching.with?.filters).toBe('.github/eval-gate-paths.yml');
    expect(text).toMatch(/dorny\/paths-filter@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  });

  it('checks the repository out without keeping the token, since the filter file is read from disk', () => {
    expect(
      using(changes, 'actions/checkout').with?.['persist-credentials'],
    ).toBe(false);
    expect(using(gate, 'actions/checkout').with?.['persist-credentials']).toBe(
      false,
    );
  });

  it('exposes whether anything matched as its output eval', () => {
    const filter = using(changes, 'dorny/paths-filter');
    expect(filter.id).toBeDefined();
    expect(changes.outputs?.eval).toBe(
      `\${{ steps.${filter.id}.outputs.eval }}`,
    );
  });

  it('is followed by the gate job, which runs when a file matched or when this job did not succeed, and never in a cancelled run', () => {
    expect(gate.needs).toBe('changes');
    expect(gate.if).toBe(
      `\${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.eval == 'true') }}`,
    );
    expect(gate.name).toBe('eval gate');
  });
});

describe('a failed filter job', () => {
  const FILTER_FAILED = "needs.changes.result != 'success'";
  const LINE =
    'verdict: inconclusive (the filter job failed, so it is not known whether the gate concerns this pull request; run the workflow again)';

  it('ends the gate inconclusive in its first real step: an error, the line in the summary, and a failure', () => {
    const failed = step(gate, /filter job failed/i);
    expect(failed.if).toBe(FILTER_FAILED);
    expect(failed.run).toContain(LINE);
    // The error annotation and the summary both carry the one line.
    expect(failed.run).toContain('"::error::$line"');
    expect(failed.run).toMatch(/echo "\$line"\n.*>> "\$GITHUB_STEP_SUMMARY"/s);
    expect(failed.run).toMatch(/^\s*exit 1\s*$/m);
  });

  it('comes right after the choice of the results folder, before anything is installed or built', () => {
    const names = gate.steps.map((s) => s.name ?? s.uses ?? '');
    expect(names[0]).toMatch(/results folder/i);
    expect(names[1]).toMatch(/filter job failed/i);
  });

  it('leaves nothing but the summary and the upload to run after it', () => {
    const afterFailure = gate.steps
      .slice(2)
      .filter((s) => s.if?.includes('always()'));
    expect(afterFailure.map((s) => s.name)).toEqual([
      'Write the job summary',
      'Keep the results',
    ]);
    // A step with no status function has the implicit success(), so the failure above skips it.
    // Any of them on another step, `!cancelled()` and `failure()` too, would run it after the failure.
    const published = new Set(['Write the job summary', 'Keep the results']);
    for (const s of gate.steps.slice(2)) {
      expect(s.if ?? '', s.name ?? s.uses).not.toContain(FILTER_FAILED);
      if (!published.has(s.name ?? '')) {
        expect(s.if ?? '', s.name ?? s.uses).not.toMatch(
          /\b(always|failure|cancelled|success)\(\)/,
        );
      }
    }
  });

  it('exits 1 when its script runs, with the error on stdout and the line in the summary', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-gate-'));
    const summary = path.join(dir, 'summary.md');
    const ran = spawnSync(
      'bash',
      ['-c', step(gate, /filter job failed/i).run ?? ''],
      {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
      },
    );
    expect(ran.status).toBe(1);
    expect(ran.stdout).toBe(`::error::${LINE}\n`);
    expect(fs.readFileSync(summary, 'utf8')).toBe(`## Eval gate\n\n${LINE}\n`);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is not hidden by a missing key, and keeps the summary free of a second heading', () => {
    const summary = step(gate, /summary/i);
    expect(summary.env?.FILTER_RESULT).toBe(`\${{ needs.changes.result }}`);
    expect(summary.run).toMatch(
      /"\$HAS_KEY" = 'true' \] && \[ "\$FILTER_RESULT" = 'success'/,
    );
    expect(step(gate, /key/i).if).toBe("env.HAS_KEY != 'true'");
  });
});

describe('the eval gate job', () => {
  it('uses the environment eval-gate, may only read the repository, and stops after 30 minutes', () => {
    expect(gate.environment).toBe('eval-gate');
    expect(gate.permissions).toEqual({ contents: 'read' });
    expect(gate['timeout-minutes']).toBe(30);
  });

  it('reads whether the key is set without holding it, and skips the paid steps when it is not', () => {
    expect(gate.env?.HAS_KEY).toBe(`\${{ ${SECRET} != '' }}`);
    for (const name of [/build the cli/i, /run the evals/i, /judge the run/i]) {
      expect(step(gate, name).if, `${name}`).toBe("env.HAS_KEY == 'true'");
    }
    const warning = step(gate, /key/i);
    expect(warning.if).toBe("env.HAS_KEY != 'true'");
    expect(warning.run).toContain('::warning::');
    expect(warning.run).toContain('GITHUB_STEP_SUMMARY');
  });

  it('gives the secret to the step that runs the eval alone', () => {
    const runEval = step(gate, /run the evals/i);
    expect(runEval.env?.OPENROUTER_API_KEY).toBe(`\${{ ${SECRET} }}`);
    const body = code(text);
    expect(body.match(/\$\{\{ secrets\.OPENROUTER_API_KEY \}\}/g)).toHaveLength(
      1,
    );
    expect(body.match(/secrets\.OPENROUTER_API_KEY/g)).toHaveLength(2);
    for (const other of gate.steps.filter((s) => s !== runEval)) {
      expect(JSON.stringify(other), other.name).not.toContain('secrets.');
    }
  });

  it('asks the core set of the gate model, ten times, k 3, without the rubrics of weight 0', () => {
    const runEval = step(gate, /run the evals/i);
    expect(runEval.run).toContain(
      '--set core --model anthropic/claude-haiku-5.5 --repeat 10 --k 3 --skip-weightless-rubrics',
    );
    expect(runEval.run).toContain('set -o pipefail');
    expect(runEval.run).toContain('run eval');
  });

  it('asks the model, the repeats and the k that gate.yaml judges', () => {
    const config = parse(
      fs.readFileSync(new URL('../gate.yaml', import.meta.url), 'utf8'),
    ) as { model: string; repeat: number; k: number };
    const { run } = step(gate, /run the evals/i);
    expect(run).toContain(`--model ${config.model}`);
    expect(run).toContain(`--repeat ${config.repeat}`);
    expect(run).toContain(`--k ${config.k}`);
  });

  it('runs the gate on the results of the eval, and keeps the exit code of the gate', () => {
    const { run } = step(gate, /judge the run/i);
    expect(run).toContain('run gate "$OUT/results.json"');
    expect(run).toContain('tee "$OUT/gate.txt"');
    expect(run).toContain('set -o pipefail');
  });

  it('writes the results of the eval into the folder that the summary and the artifact read', () => {
    const { run } = step(gate, /run the evals/i);
    expect(run).toContain('--out "$OUT"');
    expect(run).toContain('tee "$OUT/report.txt"');
  });

  it('builds the CLI, then runs the eval, then the gate, and publishes after them', () => {
    const at = (name: RegExp) => gate.steps.indexOf(step(gate, name));
    expect(at(/build the cli/i)).toBeLessThan(at(/run the evals/i));
    expect(at(/run the evals/i)).toBeLessThan(at(/judge the run/i));
    expect(at(/judge the run/i)).toBeLessThan(at(/summary/i));
    expect(at(/summary/i)).toBeLessThan(at(/keep the results/i));
  });

  it('writes the summary and keeps the results even when a step failed', () => {
    const summary = step(gate, /summary/i);
    expect(summary.if).toBe('always()');
    expect(summary.run).toContain('$GITHUB_STEP_SUMMARY');
    expect(summary.run).toContain('$OUT/gate.txt');
    expect(summary.run).toContain('$OUT/report.txt');
    expect(summary.env?.HEAD_SHA).toBe(
      `\${{ github.event.pull_request.head.sha }}`,
    );
    const upload = step(gate, /keep the results/i);
    expect(upload.if).toBe('always()');
    expect(upload.uses).toMatch(/^actions\/upload-artifact@/);
    expect(upload.with?.name).toBe(`eval-gate-\${{ github.run_id }}`);
    expect(upload.with?.path).toBe(`\${{ env.OUT }}`);
    expect(upload.with?.['retention-days']).toBe(90);
  });

  it('passes inputs and outputs to the shell as variables, never pasted into a script', () => {
    for (const s of gate.steps) {
      expect(s.run ?? '', s.name).not.toMatch(/\$\{\{/);
    }
  });
});

describe('the CI workflow', () => {
  it('starts no eval run and names no key of the evals', () => {
    const ci = code(read('workflows/ci.yml'));
    expect(ci).not.toMatch(/run eval\b/);
    expect(ci).not.toContain('OPENROUTER_API_KEY');
  });
});

describe('the filter file', () => {
  const filters = parse(read('eval-gate-paths.yml')) as { eval: string[] };

  it('holds the filter eval, a list of globs', () => {
    expect(Object.keys(filters)).toEqual(['eval']);
    expect(filters.eval.length).toBeGreaterThan(0);
  });

  it.each([
    'packages/cli/src/**',
    'tsconfig.base.json',
    'packages/evals/src/**',
    'packages/evals/cases/**',
    'packages/evals/gate.yaml',
    '.github/workflows/eval-gate.yml',
    '.github/eval-gate-paths.yml',
    '.nvmrc',
  ])('concerns %s, which can change what a run measures', (glob) => {
    expect(filters.eval).toContain(glob);
  });

  /**
   * Whether a changed file matches a glob of the filter, as the job `changes` decides it. A file of any status counts, a deleted one too.
   * The action matches with picomatch and its `dot` option, and Node's matcher is a close relative, not the same: the globs here are plain paths, `*` and `**`, where the two agree.
   */
  const concerns = (file: string) =>
    filters.eval.some((glob) => path.matchesGlob(file, glob));

  it.each([
    'packages/cli/src/instructions.ts',
    'packages/cli/src/tools/deep/nested.ts',
    'packages/cli/package.json',
    'packages/cli/tsconfig.build.json',
    'tsconfig.base.json',
    'packages/evals/src/gate/decide.ts',
    'packages/evals/cases/search.yaml',
    'packages/evals/rubrics/judge-relevance.yaml',
    'packages/evals/promptfooconfig.yaml',
    'packages/evals/gate.yaml',
    '.github/workflows/eval-gate.yml',
    '.github/eval-gate-paths.yml',
    '.nvmrc',
  ])('runs the gate for a pull request that changes %s', (file) => {
    expect(concerns(file)).toBe(true);
  });

  it.each([
    'README.md',
    'packages/cli/test/ask.test.ts',
    'packages/evals/test/gate.cli.test.ts',
    'packages/evals/README.md',
    'packages/evals/stryker.config.json',
    'packages/cli/stryker.config.json',
    'docs/src/content/docs/evals.md',
    'pnpm-lock.yaml',
    '.github/workflows/ci.yml',
    'AGENTS.md',
  ])('skips the gate for a pull request that changes only %s', (file) => {
    expect(concerns(file)).toBe(false);
  });

  it('leaves out the tests, the docs, the Stryker configs and the lockfile', () => {
    for (const glob of filters.eval) {
      expect(glob, glob).not.toMatch(/\/test\/|^docs|README|stryker|pnpm-lock/);
    }
  });
});
