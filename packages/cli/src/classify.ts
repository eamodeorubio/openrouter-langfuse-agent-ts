import {
  ApiError,
  ConfigError,
  LimitError,
  TimeoutError,
  UsageError,
} from './errors.js';

export const EXIT_OK = 0;
export const EXIT_USAGE_OR_CONFIG = 1;
export const EXIT_API = 2;
export const EXIT_LIMIT = 3;

/** What went wrong, in the terms of the exit code and of the JSON output. */
export interface Failure {
  /** A short, stable name for the kind of failure: capital letters and underscores. */
  code: string;
  exit: number;
  message: string;
}

/** The words for anything that was thrown, even a value that cannot become text. */
const reasonOf = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return String(error);
  } catch {
    return 'a value that cannot be shown';
  }
};

/**
 * The one place that tells a failure from another. Order matters: a
 * `TimeoutError` is an `ApiError`, and it is told first.
 */
export const classify = (error: unknown): Failure => {
  if (error instanceof UsageError) {
    return {
      code: 'USAGE_ERROR',
      exit: EXIT_USAGE_OR_CONFIG,
      message: error.message,
    };
  }
  if (error instanceof ConfigError) {
    return {
      code: 'CONFIG_ERROR',
      exit: EXIT_USAGE_OR_CONFIG,
      message: error.message,
    };
  }
  if (error instanceof LimitError) {
    return { code: 'LIMIT_EXCEEDED', exit: EXIT_LIMIT, message: error.message };
  }
  if (error instanceof TimeoutError) {
    return { code: 'TIMEOUT', exit: EXIT_API, message: error.message };
  }
  if (error instanceof ApiError) {
    return { code: 'API_ERROR', exit: EXIT_API, message: error.message };
  }
  return {
    code: 'UNEXPECTED_ERROR',
    exit: EXIT_API,
    message: `Unexpected error: ${reasonOf(error)}`,
  };
};
