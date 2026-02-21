import { timingSafeEqual, randomBytes } from 'node:crypto'

import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

export function validateAuthToken(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected, 'utf-8')
  const providedBuf = Buffer.from(provided, 'utf-8')

  if (expectedBuf.length !== providedBuf.length) {
    // Compare against a dummy buffer to avoid timing leak on length mismatch
    const dummy = randomBytes(expectedBuf.length)
    timingSafeEqual(expectedBuf, dummy)
    return false
  }

  return timingSafeEqual(expectedBuf, providedBuf)
}

export interface BearerAuthOptions {
  authToken: string
}

export const bearerAuthPlugin = fp(
  async (fastify: FastifyInstance, opts: BearerAuthOptions) => {
    if (!opts.authToken) {
      throw new Error(
        'server.authToken must be configured. Run `2kc server token generate` to create one.',
      )
    }

    fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.method === 'GET' && request.routeOptions.url === '/health') {
        return
      }

      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Invalid or missing auth token' })
      }

      const token = authHeader.slice(7)
      if (!validateAuthToken(opts.authToken, token)) {
        return reply.code(401).send({ error: 'Invalid or missing auth token' })
      }
    })
  },
  {
    name: 'bearer-auth',
  },
)
