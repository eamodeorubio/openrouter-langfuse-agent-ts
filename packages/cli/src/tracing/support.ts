/** The text of an error, and nothing that must stay secret. */
export type Redact = (text: string) => string;

/** The value of `make`, or of `fallback` when `make` fails: a fault in tracing is the tracer's, never the caller's. */
export const orElse = <T>(make: () => T, fallback: () => T): T => {
  try {
    return make();
  } catch {
    return fallback();
  }
};

/** Runs `work`; a fault in it is the tracer's, never the caller's. */
export const quietly = (work: () => void): void => {
  try {
    work();
  } catch {
    // Tracing must not change the answer.
  }
};

/** The value a text holds as JSON, or the text itself when it is not JSON. */
export const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** The reason a tool gave for failing: the `error` of its result, else the result. */
export const reasonOf = (output: string): string => {
  const result = parsed(output);
  const reason = (result as { error?: unknown } | null)?.error;
  return typeof reason === 'string' ? reason : output;
};

export const withTimeout = async (
  work: Promise<void>,
  ms: number,
): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** Ends an observation because the run was cut short. */
export type Abort = (reason: string) => void;

/**
 * Tracks an observation until it ends, once, by itself or by an abort,
 * whichever comes first. Gives the function that ends it by itself, and one that says whether it is still open.
 */
export const lifecycle = (open: Set<Abort>, onAbort: Abort) => {
  const abort: Abort = (reason) => {
    // Stryker disable next-line ConditionalExpression: equivalent because OpenTelemetry ignores an update and a second end on an ended span, so an observation that was ended and is then aborted is still exported once, as it was.
    if (open.delete(abort)) {
      quietly(() => onAbort(reason));
    }
  };
  open.add(abort);
  const finish = (end: () => void): void => {
    // Stryker disable next-line ConditionalExpression: equivalent because OpenTelemetry ignores an update and a second end on an ended span, so an observation that was aborted and is then ended is still exported once, as it was.
    if (open.delete(abort)) {
      quietly(end);
    }
  };
  return [finish, () => open.has(abort)] as const;
};

/** Ends every observation still open, as an error with `reason`. */
export const closeOpen = (open: Set<Abort>, reason: string): void => {
  for (const abort of [...open]) {
    abort(reason);
  }
};

/** The W3C trace context that names `observation` as the parent of what is sent with it, sampled. */
export const traceparentOf = ({
  traceId,
  id,
}: {
  traceId: string;
  id: string;
}): string => `00-${traceId}-${id}-01`;
