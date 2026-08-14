import { describe, it, expect } from 'vitest'
import { createLogger } from '@core/logger'

describe('Logger', () => {
  it('creates a pino logger with given level', () => {
    const logger = createLogger({ level: 'info', pretty: false })
    expect(logger).toBeDefined()
    expect(logger.level).toBe('info')
  })

  it('creates a child logger with module context', () => {
    const logger = createLogger({ level: 'debug', pretty: false })
    const child = logger.child({ module: 'test-module' })
    expect(child).toBeDefined()
  })

  it('defaults to info level', () => {
    const logger = createLogger({})
    expect(logger.level).toBe('info')
  })
})
