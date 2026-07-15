// ADR 0006. The floor/catch-all is 2 — specific values above it may be assigned
// per error class later without breaking the 0/1/2+ contract callers branch on.
export const ExitCode = {
  Success: 0,
  TaskFailure: 1,
  HarnessError: 2,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
