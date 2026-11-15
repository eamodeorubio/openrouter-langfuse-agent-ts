// A stand-in for `claude -p`. It logs how it was started and answers a
// judgement the way the real one does with --output-format json and a schema.
import fs from 'node:fs';

const args = process.argv.slice(2);

// The prompt comes on the input, as the real command takes it with -p.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const prompt = Buffer.concat(chunks).toString('utf8');
if (process.env.FAKE_CLAUDE_LOG) {
  // What the parent left of stdin, and how many answers its file held when it was asked.
  let answered;
  if (process.env.FAKE_CLAUDE_FILE) {
    const records = JSON.parse(
      fs.readFileSync(process.env.FAKE_CLAUDE_FILE, 'utf8'),
    );
    answered = records.filter((r) => r.opusScore !== undefined).length;
  }
  fs.appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    `${JSON.stringify({
      args,
      prompt,
      cwd: process.cwd(),
      hasOpenRouterKey: 'OPENROUTER_API_KEY' in process.env,
      answered,
      keys: Object.keys(process.env).filter((name) =>
        /OPENROUTER_|LANGFUSE_|OTEL_/.test(name),
      ),
    })}\n`,
  );
}
if (process.env.FAKE_CLAUDE_SLEEP) {
  await new Promise((r) =>
    setTimeout(r, Number(process.env.FAKE_CLAUDE_SLEEP)),
  );
}
if (prompt.includes('[[unblock]]') && process.env.FAKE_CLAUDE_BLOCK) {
  fs.rmSync(process.env.FAKE_CLAUDE_BLOCK, { recursive: true, force: true });
}
if (prompt.includes('[[longfail]]')) {
  process.stdout.write(
    JSON.stringify({ is_error: true, result: `  ${'x'.repeat(400)}  ` }),
  );
  process.exit(1);
}
if (prompt.includes('[[jsonfail]]')) {
  process.stdout.write(
    JSON.stringify({ is_error: true, result: 'You have hit your limit' }),
  );
  process.exit(1);
}
if (prompt.includes('[[silentcrash]]')) process.exit(1);
if (prompt.includes('[[sigterm]]')) process.kill(process.pid, 'SIGTERM');
if (prompt.includes('[[crash]]') || process.env.FAKE_CLAUDE_FAIL) {
  process.stderr.write('claude: something broke\n');
  process.exit(1);
}
if (prompt.includes('[[error]]')) {
  process.stdout.write(
    JSON.stringify({
      is_error: true,
      subtype: 'error_max_turns',
      result: 'out of turns',
    }),
  );
  process.exit(0);
}
if (prompt.includes('[[garbage]]')) {
  process.stdout.write('not json');
  process.exit(0);
}
if (prompt.includes('[[numverdict]]')) {
  process.stdout.write(
    JSON.stringify({
      is_error: false,
      structured_output: { verdict: 3, reason: 'x' },
    }),
  );
  process.exit(0);
}
if (prompt.includes('[[noreason]]')) {
  process.stdout.write(
    JSON.stringify({ is_error: false, structured_output: { verdict: 'yes' } }),
  );
  process.exit(0);
}
const verdict = prompt.includes('[[no]]')
  ? 'no'
  : prompt.includes('[[amb]]')
    ? 'ambiguous'
    : prompt.includes('[[badverdict]]')
      ? 'maybe'
      : 'yes';
process.stdout.write(
  JSON.stringify({
    is_error: false,
    subtype: 'success',
    ...(process.env.FAKE_CLAUDE_NOCOST
      ? {}
      : { total_cost_usd: process.env.FAKE_CLAUDE_ZEROCOST ? 0 : 0.01 }),
    structured_output: { verdict, reason: `The fake says ${verdict}.` },
  }),
);
