import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import type { AppConfig } from '../core/config.js'

export function createServer(config: AppConfig): FastifyInstance {
  const server = Fastify({
    logger: {
      level: 'info',
    },
  })

  server.get('/health', async () => {
    return { status: 'ok', uptime: process.uptime() }
  })

  server.setNotFoundHandler(async (_request, reply) => {
    await reply.status(404).send({ error: 'Not Found', statusCode: 404 })
  })

  server.setErrorHandler(async (error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500
    const message = statusCode >= 500 ? 'Internal Server Error' : error.message
    await reply.status(statusCode).send({ error: message, statusCode })
  })

  return server
}

export async function startServer(config: AppConfig): Promise<FastifyInstance> {
  const server = createServer(config)

  await server.listen({ host: config.server.host, port: config.server.port })

  const shutdown = async () => {
    server.log.info('Shutting down server...')
    await server.close()
    process.exit(0)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  server.addHook('onClose', async () => {
    process.removeListener('SIGINT', shutdown)
    process.removeListener('SIGTERM', shutdown)
  })

  return server
}
