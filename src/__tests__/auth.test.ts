/// <reference types="vitest/globals" />

import Fastify from 'fastify'

import { bearerAuthPlugin, validateAuthToken } from '../server/auth.js'

const TEST_TOKEN = 'test-secret-token-12345'

function buildApp(token: string = TEST_TOKEN) {
  const app = Fastify()
  app.register(bearerAuthPlugin, { authToken: token })

  app.get('/health', async () => {
    return { status: 'ok' }
  })

  app.get('/test', async () => {
    return { data: 'protected' }
  })

  return app
}

describe('bearerAuthPlugin', () => {
  it('passes request with valid bearer token', async () => {
    const app = buildApp()

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: 'protected' })
  })

  it('rejects request with invalid bearer token', async () => {
    const app = buildApp()

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        authorization: 'Bearer wrong-token',
      },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'Invalid or missing auth token' })
  })

  it('rejects request with no Authorization header', async () => {
    const app = buildApp()

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'Invalid or missing auth token' })
  })

  it('allows health endpoint without auth', async () => {
    const app = buildApp()

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('rejects request with malformed Authorization header', async () => {
    const app = buildApp()

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        authorization: 'Basic some-credentials',
      },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'Invalid or missing auth token' })
  })

  it('throws if authToken is not provided', async () => {
    const app = Fastify()
    app.register(bearerAuthPlugin, { authToken: '' })

    await expect(app.ready()).rejects.toThrow('server.authToken must be configured')
  })
})

describe('validateAuthToken', () => {
  it('returns true for matching tokens', () => {
    expect(validateAuthToken('abc123', 'abc123')).toBe(true)
  })

  it('returns false for non-matching tokens of same length', () => {
    expect(validateAuthToken('abc123', 'xyz789')).toBe(false)
  })

  it('returns false for tokens of different length', () => {
    expect(validateAuthToken('short', 'a-much-longer-token')).toBe(false)
  })
})
