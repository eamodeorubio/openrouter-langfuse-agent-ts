import { isObject } from './json.js';

/** The environment variable that holds the `--model` list as written, which the runner passes. Absent when the run asks every model of the config. */
export const MODEL_FILTER_ENV = 'EVAL_MODELS_FILTER';

/** The models of the matrix, as the suite declares them. None when it declares none, so that promptfoo is the one to complain. */
export const modelsOf = (suite: unknown): string[] => {
  const defaults = isObject(suite) ? suite.defaultTest : undefined;
  const vars = isObject(defaults) ? defaults.vars : undefined;
  const model = isObject(vars) ? vars.model : undefined;
  const list = Array.isArray(model) ? model : [model];
  return list.filter((id): id is string => typeof id === 'string');
};

/**
 * The models that the filter names, each once in the order of the config, and
 * the suite with `defaultTest.vars.model` cut down to them. Anything that is
 * not a model of the config, an empty id included, gives the sentence that
 * says so instead. The suite it was given stays as it was.
 */
export const narrowModels = (
  suite: unknown,
  filter: string,
): { suite: unknown; models: string[] } | string => {
  const config = modelsOf(suite);
  const ids = filter.split(',');
  for (const id of ids) {
    if (!config.includes(id)) {
      return `--model ${JSON.stringify(id)} is not a model of the config. The config holds: ${config.join(', ') || 'none'}.`;
    }
  }
  // Every id is in the config, so the config has models, and so a `defaultTest` with `vars`.
  const { defaultTest } = suite as { defaultTest: Record<string, unknown> };
  const models = config.filter((id) => ids.includes(id));
  return {
    suite: {
      ...(suite as object),
      defaultTest: {
        ...defaultTest,
        vars: { ...(defaultTest.vars as object), model: models },
      },
    },
    models,
  };
};
