/** Logger interface and default console logger for vrcsl.js SDK. */

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export function createLogger(level: LogLevel, custom?: Logger): Logger {
  const target = custom ?? {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const priority = LOG_LEVEL_PRIORITY[level];

  return {
    debug(message: string, ...args: unknown[]) {
      if (priority <= LOG_LEVEL_PRIORITY.debug) target.debug(`[VRCSL] ${message}`, ...args);
    },
    info(message: string, ...args: unknown[]) {
      if (priority <= LOG_LEVEL_PRIORITY.info) target.info(`[VRCSL] ${message}`, ...args);
    },
    warn(message: string, ...args: unknown[]) {
      if (priority <= LOG_LEVEL_PRIORITY.warn) target.warn(`[VRCSL] ${message}`, ...args);
    },
    error(message: string, ...args: unknown[]) {
      if (priority <= LOG_LEVEL_PRIORITY.error) target.error(`[VRCSL] ${message}`, ...args);
    },
  };
}
