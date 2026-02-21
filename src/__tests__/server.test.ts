/// <reference types="vitest/globals" />

import { createServer } from '../server/app.js'
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

  describe('graceful shutdown', () => {
    it('closes the server without error', async () => {
      const server = createServer()
      await server.listen({ host: config.server.host, port: config.server.port })

      await expect(server.close()).resolves.toBeUndefined()
    })
  })
})
