/** Bad arguments or no question. Exit code 1. */
export class UsageError extends Error {}

/** Missing or blank key or model, or an unreadable `.env`. Exit code 1. */
export class ConfigError extends Error {}

/** The API call failed or its response is unusable. Exit code 2. */
export class ApiError extends Error {}

/** The run was stopped by a limit the CLI sets, such as the number of tool rounds. Exit code 3. */
export class LimitError extends Error {}
