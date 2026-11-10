import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createCollector } from '../src/collector.js';
import { outputSchema } from '../src/output.js';
import type { AskEvent } from '../src/types.js';

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
const done: AskEvent = { kind: 'done', model: 'm', usage };
const args = {
  question: undefined,
  model: undefined,
  thinking: undefined,
  verbose: false,
  json: true,
};
const toolCall = (
  over: Partial<Extract<AskEvent, { kind: 'tool-call' }>> = {},
): AskEvent => ({
  kind: 'tool-call',
  round: 1,
  name: 'calculate',
  arguments: '{}',
  output: '{}',
  failed: false,
  ...over,
});

/** A collector that has the arguments of a run that parsed. */
const ready = () => {
  const collector = createCollector();
  collector.setArgs(args);
  return collector;
};

describe('createCollector', () => {
  it('builds the success object from the events', () => {
    const collector = ready();
    collector.setQuestion('2+2');
    collector.handle({ kind: 'trace', id: 'abc' });
    collector.handle({ kind: 'thinking', text: 'Add' });
    collector.handle({ kind: 'thinking', text: '.' });
    collector.handle({ kind: 'content', text: '4' });
    collector.handle({ kind: 'tool', name: 'calculate', arguments: '{}' });
    collector.handle(done);
    expect(collector.success()).toStrictEqual({
      question: '2+2',
      answer: '4',
      success: true,
      model: 'm',
      usage,
      toolCalls: [],
      args: { verbose: false },
      thinking: 'Add.',
      traceId: 'abc',
    });
  });

  it('leaves out the thinking and the trace id when there are none', () => {
    const collector = ready();
    collector.setQuestion('q');
    collector.handle({ kind: 'content', text: 'a' });
    collector.handle(done);
    expect(Object.keys(collector.success()).sort()).toEqual([
      'answer',
      'args',
      'model',
      'question',
      'success',
      'toolCalls',
      'usage',
    ]);
  });

  it('leaves out the optional usage fields that were not reported, and keeps those that were', () => {
    const collector = ready();
    collector.setQuestion('q');
    collector.handle({ kind: 'content', text: 'a' });
    collector.handle({
      kind: 'done',
      model: 'm',
      usage: {
        ...usage,
        reasoningTokens: 0,
        cachedTokens: undefined,
        cost: 0.5,
      },
    });
    expect(collector.success()).toMatchObject({
      usage: { ...usage, reasoningTokens: 0, cost: 0.5 },
    });
    expect('cachedTokens' in collector.success().usage).toBe(false);
  });

  it('gives the failure object neither model nor usage, even after a done event', () => {
    const collector = createCollector();
    collector.handle(done);
    const failed = collector.failure({ code: 'API_ERROR', message: 'm' });
    expect('model' in failed).toBe(false);
    expect('usage' in failed).toBe(false);
  });

  it('refuses to build a success object before the run has been completed', () => {
    const collector = ready();
    collector.setQuestion('q');
    collector.handle({ kind: 'content', text: 'a' });
    expect(() => collector.success()).toThrow(
      'A success object needs the completion of the run.',
    );
  });

  it('builds the failure object with what is known', () => {
    const collector = createCollector();
    expect(
      collector.failure({ code: 'USAGE_ERROR', message: 'No question.' }),
    ).toStrictEqual({
      success: false,
      error: { code: 'USAGE_ERROR', message: 'No question.' },
    });
    collector.setQuestion('q');
    collector.handle({ kind: 'content', text: 'Hel' });
    collector.handle({ kind: 'thinking', text: 'Hm' });
    collector.handle({ kind: 'trace', id: 't' });
    expect(
      collector.failure({ code: 'API_ERROR', message: 'Stream failed.' }),
    ).toStrictEqual({
      question: 'q',
      answer: 'Hel',
      success: false,
      thinking: 'Hm',
      traceId: 't',
      error: { code: 'API_ERROR', message: 'Stream failed.' },
    });
  });

  it('refuses to build a success object before the arguments are known', () => {
    const collector = createCollector();
    collector.handle({ kind: 'content', text: 'a' });
    collector.handle(done);
    expect(() => collector.success()).toThrow(
      'A success object needs the arguments of the run.',
    );
  });

  it('lists the tool calls in the order of the events, with every field', () => {
    const collector = ready();
    collector.handle({ kind: 'content', text: 'a' });
    collector.handle(toolCall({ name: 'one' }));
    collector.handle(
      toolCall({ name: 'two', round: 2, failed: true, output: 'bad' }),
    );
    collector.handle(done);
    expect(collector.success().toolCalls).toStrictEqual([
      { round: 1, name: 'one', arguments: '{}', output: '{}', failed: false },
      { round: 2, name: 'two', arguments: '{}', output: 'bad', failed: true },
    ]);
  });

  it('leaves the tool calls out of a failure until the run has started, and lists them after, empty or not', () => {
    const collector = ready();
    expect(
      collector.failure({ code: 'CONFIG_ERROR', message: 'm' }),
    ).not.toHaveProperty('toolCalls');
    collector.startRun();
    expect(
      collector.failure({ code: 'API_ERROR', message: 'm' }),
    ).toMatchObject({ toolCalls: [] });
    collector.handle(toolCall());
    expect(
      collector.failure({ code: 'API_ERROR', message: 'm' }),
    ).toMatchObject({
      toolCalls: [{ name: 'calculate' }],
    });
  });

  describe('args', () => {
    it.each([
      [{ verbose: true }, { verbose: true }],
      [
        { verbose: false, thinking: true },
        { verbose: false, thinking: true },
      ],
      [
        { verbose: false, thinking: false },
        { verbose: false, thinking: false },
      ],
      [
        { verbose: false, model: 'x/y' },
        { verbose: false, model: 'x/y' },
      ],
      [
        { verbose: true, thinking: false, model: 'x/y' },
        { verbose: true, thinking: false, model: 'x/y' },
      ],
    ])(
      'records %o as %o, and leaves out what was not given',
      (given, expected) => {
        const collector = createCollector();
        collector.setArgs({ ...args, ...given });
        expect(
          collector.failure({ code: 'CONFIG_ERROR', message: 'm' }),
        ).toHaveProperty('args', expected);
        expect(
          Object.keys(
            (
              collector.failure({ code: 'CONFIG_ERROR', message: 'm' }) as {
                args: object;
              }
            ).args,
          ),
        ).toEqual(Object.keys(expected));
      },
    );

    it('is left out of a failure when the arguments were never set', () => {
      expect(
        createCollector().failure({ code: 'USAGE_ERROR', message: 'm' }),
      ).not.toHaveProperty('args');
    });

    it('does not repeat the question or the json flag', () => {
      const collector = createCollector();
      collector.setArgs({ ...args, question: 'q' });
      expect(
        JSON.stringify(collector.failure({ code: 'X', message: 'm' })),
      ).not.toContain('"q"');
    });

    it('replaces a secret in the model', () => {
      const collector = createCollector();
      collector.setArgs({ ...args, model: 'sk-secret/x' });
      collector.setSecrets(['sk-secret', undefined]);
      expect(collector.failure({ code: 'X', message: 'm' })).toHaveProperty(
        'args.model',
        '[redacted]/x',
      );
    });
  });

  it('passes the arguments and the output of a tool call through byte for byte, however long, and the object stays valid JSON', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.boolean(),
        (argumentsText, output, failed) => {
          const collector = ready();
          collector.setQuestion('q');
          collector.handle({ kind: 'content', text: 'a' });
          collector.handle(
            toolCall({ arguments: argumentsText, output, failed }),
          );
          collector.handle(done);
          const object = collector.success();
          const [entry] = JSON.parse(JSON.stringify(object)).toolCalls;
          expect(entry).toEqual({
            round: 1,
            name: 'calculate',
            arguments: argumentsText,
            output,
            failed,
          });
          expect(
            outputSchema.safeParse(JSON.parse(JSON.stringify(object))).success,
          ).toBe(true);
        },
      ),
    );
    const huge = 'x'.repeat(200_000);
    const collector = ready();
    collector.handle({ kind: 'content', text: 'a' });
    collector.handle(toolCall({ output: huge }));
    collector.handle(done);
    expect(collector.success().toolCalls[0]?.output).toHaveLength(200_000);
  });

  it('builds objects that match the schema and survive JSON, for any text', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(fc.string({ minLength: 1 })),
        fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        (question, thinking, answer, id) => {
          const collector = ready();
          collector.setQuestion(question);
          if (id) {
            collector.handle({ kind: 'trace', id });
          }
          for (const text of thinking) {
            collector.handle({ kind: 'thinking', text });
          }
          for (const text of answer) {
            collector.handle({ kind: 'content', text });
          }
          collector.handle(done);
          const object = collector.success();
          expect(
            outputSchema.parse(JSON.parse(JSON.stringify(object))),
          ).toEqual(object);
          expect(object).toMatchObject({ question, answer: answer.join('') });
          const failed = collector.failure({ code: 'API_ERROR', message: 'm' });
          expect(
            outputSchema.parse(JSON.parse(JSON.stringify(failed))),
          ).toEqual(failed);
        },
      ),
    );
  });
});
