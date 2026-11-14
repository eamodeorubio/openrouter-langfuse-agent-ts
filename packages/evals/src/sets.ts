/** The sets a case may belong to. The three overlap: `core` is a case for each error class, `judge` the cases a rubric grades, `full` every case. */
export const SET_NAMES = ['core', 'judge', 'full'] as const;
export type SetName = (typeof SET_NAMES)[number];
