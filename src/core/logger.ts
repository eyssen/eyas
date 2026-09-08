import pino, { type Logger } from 'pino'

export interface LoggerOptions {
  level?: string
  pretty?: boolean
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info'
  const pretty = options.pretty ?? false

  return pino({
    level,
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  })
}
