import { SignJWT, jwtVerify } from 'jose'
import type { AccessGrant } from './grant.js'

export interface GrantPayload {
  id: string
  requestId: string
  secretUuids: string[]
  grantedAt: string
  expiresAt: string
  commandHash?: string
}

export async function signGrant(
  grant: AccessGrant,
  privateKey: CryptoKey,
  commandHash?: string,
): Promise<string> {
  const iat = Math.floor(new Date(grant.grantedAt).getTime() / 1000)
  const exp = Math.floor(new Date(grant.expiresAt).getTime() / 1000)

  const payload: Record<string, unknown> = {
    secretUuids: grant.secretUuids,
  }
  if (commandHash !== undefined) {
    payload.commandHash = commandHash
  }

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setJti(grant.id)
    .setSubject(grant.requestId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(privateKey)
}

export async function verifyGrant(jws: string, publicKey: CryptoKey): Promise<GrantPayload> {
  const { payload } = await jwtVerify(jws, publicKey, { clockTolerance: 60 })

  const { jti, sub, iat, exp, secretUuids, commandHash } = payload as {
    jti?: string
    sub?: string
    iat?: number
    exp?: number
    secretUuids?: string[]
    commandHash?: string
  }

  if (!jti) throw new Error('Missing jti claim in JWS')
  if (!sub) throw new Error('Missing sub claim in JWS')
  if (!Array.isArray(secretUuids) || !secretUuids.every((s) => typeof s === 'string'))
    throw new Error('Missing or invalid secretUuids claim in JWS')
  if (iat === undefined) throw new Error('Missing iat claim in JWS')
  if (exp === undefined) throw new Error('Missing exp claim in JWS')

  const result: GrantPayload = {
    id: jti,
    requestId: sub,
    secretUuids,
    grantedAt: new Date(iat * 1000).toISOString(),
    expiresAt: new Date(exp * 1000).toISOString(),
  }
  if (commandHash !== undefined) {
    result.commandHash = commandHash
  }
  return result
}
