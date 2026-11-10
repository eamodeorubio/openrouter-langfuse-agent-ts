/** Bad arguments or no question. Exit code 1. */
export class UsageError extends Error {}

/** Missing or blank key or model, or an unreadable `.env`. Exit code 1. */
export class ConfigError extends Error {}

/** The API call failed or its response is unusable. Exit code 2. */
export class ApiError extends Error {}

/** The run was stopped by a limit the CLI sets, such as the number of tool rounds. Exit code 3. */
export class LimitError extends Error {}

/** The API went quiet for longer than the idle limit. An `ApiError` with its own code in the JSON output. Exit code 2. */
export class TimeoutError extends ApiError {}

/** The `error.code` of a run stopped by a limit, and the tag of a tool call that was refused for it. */
export const LIMIT_EXCEEDED = 'LIMIT_EXCEEDED';

/** The tag of a tool call that had not returned when the run failed. It is never an `error.code`. */
export const TOOL_CALL_NOT_COMPLETED = 'TOOL_CALL_NOT_COMPLETED';

/** The output of a tool call that has no result to show: `[CODE] reason`. */
export const tagged = (code: string, reason: string): string =>
  `[${code}] ${reason}`;
