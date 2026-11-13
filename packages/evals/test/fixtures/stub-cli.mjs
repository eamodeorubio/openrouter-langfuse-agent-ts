#!/usr/bin/env node
// A stand-in for the built CLI. It behaves by the start of the question, so
// one eval run can hold every outcome the provider has to handle.
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const question = flag('-q');
const model = flag('--model');

// Proof that the CLI was started at all.
if (process.env.STUB_MARK) {
  fs.appendFileSync(process.env.STUB_MARK, 'started\n');
}

const success = (extra = {}) => ({
  question,
  answer: 'GOOD answer',
  success: true,
  model,
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cost: 0.01 },
  toolCalls: [
    {
      round: 1,
      name: 'get_model',
      arguments: '{"slug":"a/b"}',
      output: '{"id":"a/b"}',
      failed: false,
    },
  ],
  args: { verbose: false, model },
  ...extra,
});

if (question.startsWith('exit1')) {
  process.stderr.write(
    `${JSON.stringify({ success: false, error: { code: 'API_ERROR', message: 'boom' } })}\n`,
  );
  process.exit(1);
} else if (question.startsWith('garbage')) {
  process.stdout.write('hello');
} else if (question.startsWith('nosuccess')) {
  process.stdout.write(JSON.stringify({ success: false, answer: 'x' }));
} else if (question.startsWith('sleep')) {
  setTimeout(() => process.stdout.write(JSON.stringify(success())), 60_000);
} else if (question.startsWith('echo')) {
  process.stdout.write(
    JSON.stringify(success({ answer: JSON.stringify(args) })),
  );
} else if (question.startsWith('usage:')) {
  process.stdout.write(
    JSON.stringify(success({ usage: JSON.parse(question.slice(6)) })),
  );
} else if (question.startsWith('nousage')) {
  const { usage, ...rest } = success();
  process.stdout.write(JSON.stringify(rest));
} else if (question.startsWith('partial')) {
  process.stdout.write(
    JSON.stringify(success({ usage: { promptTokens: 1, cost: 0.3 } })),
  );
} else if (question.startsWith('strcost')) {
  process.stdout.write(
    JSON.stringify(
      success({
        usage: {
          promptTokens: 1,
          completionTokens: 2,
          totalTokens: 3,
          cost: '0.5',
        },
      }),
    ),
  );
} else if (question.startsWith('null')) {
  process.stdout.write('null');
} else if (question.startsWith('long')) {
  process.stdout.write('x'.repeat(500));
} else if (question.startsWith('killed')) {
  process.kill(process.pid, 'SIGKILL');
} else if (question.startsWith('nocost')) {
  const { usage, ...rest } = success();
  const { cost, ...withoutCost } = usage;
  process.stdout.write(JSON.stringify({ ...rest, usage: withoutCost }));
} else if (question.startsWith('wrong')) {
  process.stdout.write(JSON.stringify(success({ answer: 'a bad answer' })));
} else {
  process.stdout.write(JSON.stringify(success()));
}
