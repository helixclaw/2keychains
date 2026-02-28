import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import type { Service } from '../core/service.js'

function mapErrorToStatus(error: Error): number {
  const msg = error.message.toLowerCase()
  if (msg.includes('locked')) return 403
  if (msg.includes('not found') || msg.includes('no grant found')) return 404
  if (msg.includes('already exists')) return 409
  if (msg.includes('must') || msg.includes('required')) return 400
  return 500
}

function mapStatusToMessage(status: number): string {
  if (status === 404) return 'Resource not found'
  if (status === 403) return 'Access denied'
  if (status === 409) return 'Conflict'
  if (status === 400) return 'Bad request'
  return 'Internal Server Error'
}

function handleError(error: unknown): never {
  if (error instanceof Error) {
    const status = mapErrorToStatus(error)
    ;(error as Error & { statusCode?: number }).statusCode = status
    if (status < 500) {
      error.message = mapStatusToMessage(status)
    }
    throw error
  }
  throw Object.assign(new Error(String(error)), { statusCode: 500 })
}

export interface RoutePluginOptions {
  service: Service
}

export const routePlugin = fp(
  async (fastify: FastifyInstance, opts: RoutePluginOptions) => {
    const { service } = opts

    // GET /api/keys/public — expose server's signing public key for grant verification
    fastify.get('/api/keys/public', async () => {
      const publicKey = await service.keys.getPublicKey().catch(handleError)
      return { publicKey }
    })

    // GET /api/secrets — list secrets (metadata only)
    fastify.get('/api/secrets', async () => service.secrets.list().catch(handleError))

    // POST /api/secrets — add a secret
    fastify.post<{ Body: { ref: string; value: string; tags?: string[] } }>(
      '/api/secrets',
      {
        schema: {
          body: {
            type: 'object',
            required: ['ref', 'value'],
            properties: {
              ref: { type: 'string' },
              value: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      async (request, reply) => {
        const { ref, value, tags } = request.body
        const result = await service.secrets.add(ref, value, tags).catch(handleError)
        return reply.code(201).send(result)
      },
    )

    // DELETE /api/secrets/:uuid — remove a secret
    fastify.delete<{ Params: { uuid: string } }>(
      '/api/secrets/:uuid',
      {
        schema: {
          params: {
            type: 'object',
            required: ['uuid'],
            properties: {
              uuid: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
      async (request, reply) => {
        await service.secrets.remove(request.params.uuid).catch(handleError)
        return reply.code(204).send()
      },
    )

    // GET /api/secrets/resolve/:refOrUuid — resolve metadata (registered before /:uuid to take priority)
    fastify.get<{ Params: { refOrUuid: string } }>(
      '/api/secrets/resolve/:refOrUuid',
      {
        schema: {
          params: {
            type: 'object',
            required: ['refOrUuid'],
            properties: {
              refOrUuid: { type: 'string', minLength: 1 },
            },
          },
        },
      },
      async (request) => service.secrets.resolve(request.params.refOrUuid).catch(handleError),
    )

    // GET /api/secrets/:uuid — get metadata by uuid
    fastify.get<{ Params: { uuid: string } }>(
      '/api/secrets/:uuid',
      {
        schema: {
          params: {
            type: 'object',
            required: ['uuid'],
            properties: {
              uuid: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
      async (request) => service.secrets.getMetadata(request.params.uuid).catch(handleError),
    )

    // POST /api/requests — create access request
    fastify.post<{
      Body: {
        secretUuids: string[]
        reason: string
        taskRef: string
        duration?: number
        command?: string
      }
    }>(
      '/api/requests',
      {
        schema: {
          body: {
            type: 'object',
            required: ['secretUuids', 'reason', 'taskRef'],
            properties: {
              secretUuids: { type: 'array', items: { type: 'string' } },
              reason: { type: 'string' },
              taskRef: { type: 'string' },
              duration: { type: 'number' },
              command: { type: 'string' },
            },
          },
        },
      },
      async (request, reply) => {
        const { secretUuids, reason, taskRef, duration, command } = request.body
        const result = await service.requests
          .create(secretUuids, reason, taskRef, duration, command)
          .catch(handleError)
        return reply.code(201).send(result)
      },
    )

    // GET /api/grants/:requestId — get grant status
    fastify.get<{ Params: { requestId: string } }>(
      '/api/grants/:requestId',
      {
        schema: {
          params: {
            type: 'object',
            required: ['requestId'],
            properties: {
              requestId: { type: 'string', minLength: 1 },
            },
          },
        },
      },
      async (request) => service.grants.getStatus(request.params.requestId).catch(handleError),
    )

    // GET /api/grants/:requestId/signed — get signed JWS token only
    fastify.get<{ Params: { requestId: string } }>(
      '/api/grants/:requestId/signed',
      {
        schema: {
          params: {
            type: 'object',
            required: ['requestId'],
            properties: {
              requestId: { type: 'string', minLength: 1 },
            },
          },
        },
      },
      async (request) => {
        const result = await service.grants.getStatus(request.params.requestId).catch(handleError)

        if (result.status !== 'approved') {
          const err = new Error(`Grant not approved: status is ${result.status}`)
          ;(err as Error & { statusCode?: number }).statusCode = 400
          throw err
        }

        if (!result.jws) {
          const err = new Error('No signed grant available for this request')
          ;(err as Error & { statusCode?: number }).statusCode = 404
          throw err
        }

        // Return JWS wrapped in object for proper JSON serialization
        return { jws: result.jws }
      },
    )

    // POST /api/inject — resolve secrets for injection
    //
    // Security boundary: authenticated callers are trusted to run commands.
    // The command parameter is intentionally user-supplied — this endpoint exists
    // to inject secrets into arbitrary commands. The auth token is the sole
    // security boundary; callers with a valid token are assumed authorized.
    fastify.post<{ Body: { requestId: string; command: string; envVarName?: string } }>(
      '/api/inject',
      {
        schema: {
          body: {
            type: 'object',
            required: ['requestId', 'command'],
            properties: {
              requestId: { type: 'string' },
              command: { type: 'string' },
              envVarName: { type: 'string' },
            },
          },
        },
      },
      async (request) => {
        const { requestId, command, envVarName } = request.body
        return service
          .inject(requestId, command, envVarName != null ? { envVarName } : undefined)
          .catch(handleError)
      },
    )
  },
  { name: 'routes' },
)
