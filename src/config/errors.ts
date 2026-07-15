// Config loading/validation errors are a harness-error class (ADR 0006: exit code 2+, not a
// crash with a raw stack trace). The CLI catches ConfigError and maps it to ExitCode.HarnessError.

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
