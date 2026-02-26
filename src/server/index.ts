import { loadConfig } from '../core/config.js'
import { resolveService } from '../core/service.js'
import { startServer } from './app.js'

try {
  const config = loadConfig()
  const service = resolveService(config)
  const authToken = config.server.authToken
  if (!authToken) {
    console.error('server.authToken is required. Run 2kc server token generate.')
    process.exit(1)
  }
  await startServer(config, service, authToken)
} catch (error) {
  console.error('Failed to start server:', error instanceof Error ? error.message : error)
  process.exit(1)
}
