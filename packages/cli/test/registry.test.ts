import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { functionTools, runTool } from '../src/tools/registry.js';
import type { Tool, ToolContext } from '../src/tools/types.js';

const context = {} as ToolContext;

const echo: Tool = {
  name: 'echo',
  description: 'Gives back what it got.',
  parameters: z
    .object({
      deep: z.object({ n: z.number() }).optional(),
      list: z.array(z.string()).optional(),
    })
    .strict(),
  run: async (args) => ({ ok: true, value: args }),
};
const other: Tool = { ...echo, name: 'other' };
const failing: Tool = {
  ...echo,
  name: 'failing',
  run: async () => ({ ok: false, message: 'it broke' }),
};

describe('runTool', () => {
  it('gives the value of a tool as JSON', async () => {
    expect(await runTool([echo], 'echo', '{"deep":{"n":1}}', context)).toBe(
      '{"deep":{"n":1}}',
    );
  });

  it('gives a failure as a JSON object with an error field', async () => {
    expect(await runTool([failing], 'failing', '{}', context)).toBe(
      '{"error":"it broke"}',
    );
  });

  it('treats empty arguments as an empty object', async () => {
    expect(await runTool([echo], 'echo', '', context)).toBe('{}');
  });

  it('names the unknown tool and lists the known ones, separated by commas', async () => {
    const result = JSON.parse(
      await runTool([echo, other], 'nope', '{}', context),
    );
    expect(result.error).toBe(
      'Unknown tool "nope". The tools are: echo, other.',
    );
  });

  it('says the arguments are not JSON', async () => {
    const result = JSON.parse(await runTool([echo], 'echo', '{', context));
    expect(result.error).toMatch(/^The arguments are not valid JSON: /);
  });

  it('names the path of a nested argument that is wrong', async () => {
    const result = JSON.parse(
      await runTool([echo], 'echo', '{"deep":{"n":"x"}}', context),
    );
    expect(result.error).toMatch(/^Invalid arguments\. deep\.n: /);
  });

  it('names the position in a list that is wrong', async () => {
    const result = JSON.parse(
      await runTool([echo], 'echo', '{"list":["a",2]}', context),
    );
    expect(result.error).toMatch(/list\.1: /);
  });

  it('reports every problem, separated by semicolons, and calls a problem with no path "arguments"', async () => {
    const result = JSON.parse(
      await runTool([echo], 'echo', '{"deep":{"n":"x"},"extra":1}', context),
    );
    expect(result.error).toMatch(
      /^Invalid arguments\. deep\.n: .+; arguments: .+extra/,
    );
  });
});

describe('functionTools', () => {
  it('offers each tool with its name, description and JSON Schema, without the schema marker', () => {
    const [tool] = functionTools([echo]);
    expect(tool).toMatchObject({
      type: 'function',
      function: {
        name: 'echo',
        description: 'Gives back what it got.',
        parameters: { type: 'object', additionalProperties: false },
      },
    });
    expect(
      (tool as { function: { parameters: object } }).function.parameters,
    ).not.toHaveProperty('$schema');
  });
});
