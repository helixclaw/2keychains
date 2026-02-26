import { loadConfig } from '../core/config.js'
import { resolveService } from '../core/service.js'
import { startServer } from './app.js'

try {
  const config = loadConfig()
  const service = resolveService(config)
  await startServer(config, service)
} catch (error) {
  console.error('Failed to start server:', error instanceof Error ? error.message : error)
  process.exit(1)
}
