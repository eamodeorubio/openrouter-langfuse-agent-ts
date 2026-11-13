/** Where a command writes: results to `out` (stdout), diagnostics to `err` (stderr). */
export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
