import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createCollector } from '../src/collector.js';
import { outputSchema } from '../src/output.js';
import type { AskEvent } from '../src/types.js';

const done: AskEvent = {
  kind: 'done',
  model: 'm',
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
};

describe('createCollector', () => {
  it('builds the success object from the events', () => {
    const collector = createCollector();
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
      thinking: 'Add.',
      traceId: 'abc',
    });
  });

  it('leaves out the thinking and the trace id when there are none', () => {
    const collector = createCollector();
    collector.setQuestion('q');
    collector.handle({ kind: 'content', text: 'a' });
    expect(Object.keys(collector.success())).toEqual([
      'question',
      'answer',
      'success',
    ]);
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

  it('builds objects that match the schema and survive JSON, for any text', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(fc.string({ minLength: 1 })),
        fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        (question, thinking, answer, id) => {
          const collector = createCollector();
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
