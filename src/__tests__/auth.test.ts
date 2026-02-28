/// <reference types="vitest/globals" />

import { randomBytes } from 'node:crypto'

import Fastify from 'fastify'
import { SignJWT } from 'jose'

import { bearerAuthPlugin, validateAuthToken } from '../server/auth.js'

const TEST_TOKEN = 'test-secret-token-12345'
const TEST_SESSION_SECRET = randomBytes(32)
const TEST_SESSION_TTL_MS = 3_600_000

function buildApp(
  token: string = TEST_TOKEN,
  sessionSecret: Uint8Array = TEST_SESSION_SECRET,
  sessionTtlMs: number = TEST_SESSION_TTL_MS,
) {
  const app = Fastify()
  app.register(bearerAuthPlugin, { authToken: token, sessionSecret, sessionTtlMs })

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
    app.register(bearerAuthPlugin, {
      authToken: '',
      sessionSecret: TEST_SESSION_SECRET,
      sessionTtlMs: TEST_SESSION_TTL_MS,
    })

    await expect(app.ready()).rejects.toThrow('server.authToken must be configured')
  })
})

describe('session JWT auth', () => {
  it('POST /api/auth/login with valid token returns sessionToken and expiresAt', async () => {
    const app = buildApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { token: TEST_TOKEN },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(typeof body.sessionToken).toBe('string')
    expect(typeof body.expiresAt).toBe('string')
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('POST /api/auth/login with invalid token returns 401', async () => {
    const app = buildApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { token: 'wrong-token' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'Invalid or missing auth token' })
  })

  it('POST /api/auth/login with missing token field returns 401', async () => {
    const app = buildApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: {},
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'Invalid or missing auth token' })
  })

  it('request with valid session JWT passes auth', async () => {
    const app = buildApp()

    // First, get a session token via login
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { token: TEST_TOKEN },
    })
    const { sessionToken } = loginResponse.json()

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: `Bearer ${sessionToken}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: 'protected' })
  })

  it('request with expired session JWT returns 401', async () => {
    const app = buildApp()

    const now = Math.floor(Date.now() / 1000)
    const expiredToken = await new SignJWT({ sub: 'client' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now - 7200)
      .setExpirationTime(now - 3600)
      .sign(TEST_SESSION_SECRET)

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: `Bearer ${expiredToken}` },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'Invalid or missing auth token' })
  })

  it('request with JWT signed by wrong secret returns 401', async () => {
    const app = buildApp()

    const wrongSecret = randomBytes(32)
    const now = Math.floor(Date.now() / 1000)
    const badToken = await new SignJWT({ sub: 'client' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(wrongSecret)

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: `Bearer ${badToken}` },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'Invalid or missing auth token' })
  })

  it('request with static bearer token still passes (backward compat)', async () => {
    const app = buildApp()

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: 'protected' })
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
