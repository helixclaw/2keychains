import { timingSafeEqual, randomBytes } from 'node:crypto'

import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SignJWT, jwtVerify } from 'jose'

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
  sessionSecret: Uint8Array
  sessionTtlMs: number
}

export const bearerAuthPlugin = fp(
  async (fastify: FastifyInstance, opts: BearerAuthOptions) => {
    if (!opts.authToken) {
      throw new Error(
        'server.authToken must be configured. Run `2kc server token generate` to create one.',
      )
    }

    fastify.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { token?: unknown }
      const provided = body?.token

      if (typeof provided !== 'string' || !validateAuthToken(opts.authToken, provided)) {
        return reply.code(401).send({ error: 'Invalid or missing auth token' })
      }

      const now = Math.floor(Date.now() / 1000)
      const exp = now + Math.floor(opts.sessionTtlMs / 1000)
      const expiresAt = new Date(Date.now() + opts.sessionTtlMs).toISOString()

      const sessionToken = await new SignJWT({ sub: 'client' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(now)
        .setExpirationTime(exp)
        .sign(opts.sessionSecret)

      return reply.code(200).send({ sessionToken, expiresAt })
    })

    fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.method === 'GET' && request.routeOptions.url === '/health') {
        return
      }
      if (request.method === 'POST' && request.routeOptions.url === '/api/auth/login') {
        return
      }

      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Invalid or missing auth token' })
      }

      const token = authHeader.slice(7)

      // Accept static bearer token (backward compat) — skip if token looks like a JWT
      // (contains dots) since validateAuthToken would always fail and wastes allocation
      if (!token.includes('.') && validateAuthToken(opts.authToken, token)) {
        return
      }

      // Accept valid session JWT
      try {
        await jwtVerify(token, opts.sessionSecret)
        return
      } catch {
        return reply.code(401).send({ error: 'Invalid or missing auth token' })
      }
    })
  },
  {
    name: 'bearer-auth',
  },
)
