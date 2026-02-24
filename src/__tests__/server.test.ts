/// <reference types="vitest/globals" />

import { createServer, startServer } from '../server/app.js'
import { defaultConfig } from '../core/config.js'

describe('HTTP Server', () => {
  const config = {
    ...defaultConfig(),
    server: { host: '127.0.0.1', port: 0 },
  }

  describe('GET /health', () => {
    it('returns 200 with status ok and uptime', async () => {
      const server = createServer()
      const response = await server.inject({ method: 'GET', url: '/health' })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.status).toBe('ok')
      expect(typeof body.uptime).toBe('number')

      await server.close()
    })
  })

  describe('404 handling', () => {
    it('returns 404 JSON for unknown routes', async () => {
      const server = createServer()
      const response = await server.inject({ method: 'GET', url: '/nonexistent' })

      expect(response.statusCode).toBe(404)
      const body = JSON.parse(response.body)
      expect(body.error).toBe('Not Found')
      expect(body.statusCode).toBe(404)

      await server.close()
    })
  })

  describe('error handling', () => {
    it('returns 500 with generic message for internal errors', async () => {
      const server = createServer()

      // Register a route that throws an internal error
      server.get('/test-internal-error', async () => {
        throw new Error('Internal failure')
      })

      const response = await server.inject({ method: 'GET', url: '/test-internal-error' })

      expect(response.statusCode).toBe(500)
      const body = JSON.parse(response.body)
      expect(body.error).toBe('Internal Server Error')
      expect(body.statusCode).toBe(500)

      await server.close()
    })

    it('returns 4xx with error message for client errors', async () => {
      const server = createServer()

      // Register a route that throws a 400 error
      server.get('/test-client-error', async () => {
        const err = new Error('Bad request data') as Error & { statusCode: number }
        err.statusCode = 400
        throw err
      })

      const response = await server.inject({ method: 'GET', url: '/test-client-error' })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error).toBe('Bad request data')
      expect(body.statusCode).toBe(400)

      await server.close()
    })
  })

  describe('graceful shutdown', () => {
    it('closes the server without error', async () => {
      const server = createServer()
      await server.listen({ host: config.server.host, port: config.server.port })

      await expect(server.close()).resolves.toBeUndefined()
    })
  })

  describe('startServer', () => {
    it('registers signal handlers and removes them on close', async () => {
      const originalListeners = {
        SIGINT: process.listenerCount('SIGINT'),
        SIGTERM: process.listenerCount('SIGTERM'),
      }

      const server = await startServer(config)

      // Signal handlers should have been added
      expect(process.listenerCount('SIGINT')).toBe(originalListeners.SIGINT + 1)
      expect(process.listenerCount('SIGTERM')).toBe(originalListeners.SIGTERM + 1)

      await server.close()

      // Signal handlers should be removed after close
      expect(process.listenerCount('SIGINT')).toBe(originalListeners.SIGINT)
      expect(process.listenerCount('SIGTERM')).toBe(originalListeners.SIGTERM)
    })

    it('returns a listening server', async () => {
      const server = await startServer(config)

      const response = await server.inject({ method: 'GET', url: '/health' })
      expect(response.statusCode).toBe(200)

      await server.close()
    })
  })
})
