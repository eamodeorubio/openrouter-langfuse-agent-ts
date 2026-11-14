import { currentSnapshot } from '../oracle/catalog.js';
import { slugTokens } from './slugs.js';

/** The models of the snapshot that a question names, in lower case, in the order it names them. */
export const questionModels = (question: string): string[] => {
  const known = new Set(
    currentSnapshot().models.map((model) => model.id.toLowerCase()),
  );
  return slugTokens(question).filter((slug) => known.has(slug));
};
