import { loadConfig } from '../core/config.js'
import { startServer } from './app.js'

try {
  const config = loadConfig()
  await startServer(config)
} catch (error) {
  console.error('Failed to start server:', error instanceof Error ? error.message : error)
  process.exit(1)
}
