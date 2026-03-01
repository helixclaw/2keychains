import { loadConfig } from '../core/config.js'
import { resolveService, LocalService } from '../core/service.js'
import { startServer } from './app.js'

interface UnlockIpcMessage {
  type: 'unlock'
  password: string
}

interface UnlockResultIpcMessage {
  type: 'unlock-result'
  success: boolean
  error?: string
}

interface ReadyIpcMessage {
  type: 'ready'
}

type IpcMessage = UnlockIpcMessage | UnlockResultIpcMessage | ReadyIpcMessage

try {
  const config = loadConfig()
  const service = await resolveService(config)

  // Handle IPC unlock flow before starting server
  if (process.send) {
    // Wait for unlock message (or timeout for non-unlock starts)
    await new Promise<void>((resolve) => {
      let unlockHandled = false

      process.on('message', async (msg: IpcMessage) => {
        if (msg.type === 'unlock' && !unlockHandled) {
          unlockHandled = true
          try {
            await (service as LocalService).unlock(msg.password, { serverMode: true })
            process.send!({ type: 'unlock-result', success: true } as UnlockResultIpcMessage)
          } catch (err) {
            process.send!({
              type: 'unlock-result',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            } as UnlockResultIpcMessage)
          }
          resolve()
        }
      })

      // Signal ready and give parent 500ms to send unlock message
      // If no unlock comes, proceed with server start anyway
      process.send!({ type: 'ready' } as ReadyIpcMessage)
      setTimeout(() => {
        if (!unlockHandled) resolve()
      }, 500)
    })
  }

  await startServer(config, service)
} catch (error) {
  console.error('Failed to start server:', error instanceof Error ? error.message : error)
  process.exit(1)
}
