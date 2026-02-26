import { generateKeyPair, exportJWK, importJWK } from 'jose'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

interface KeysFile {
  publicKey: JsonWebKey
  privateKey: JsonWebKey
}

export interface ServerKeys {
  publicKey: CryptoKey
  privateKey: CryptoKey
}

function isEdDSAJwk(key: unknown): key is JsonWebKey {
  return (
    key !== null &&
    typeof key === 'object' &&
    (key as Record<string, unknown>).kty === 'OKP' &&
    (key as Record<string, unknown>).crv === 'Ed25519'
  )
}

export async function loadOrGenerateKeyPair(keyFilePath: string): Promise<ServerKeys> {
  try {
    const raw = readFileSync(keyFilePath, 'utf-8')
    const keysFile = JSON.parse(raw) as KeysFile
    if (!isEdDSAJwk(keysFile.publicKey) || !isEdDSAJwk(keysFile.privateKey)) {
      throw new Error('Key file contains invalid key format: expected Ed25519 OKP keys')
    }
    const publicKey = await importJWK(keysFile.publicKey, 'EdDSA')
    const privateKey = await importJWK(keysFile.privateKey, 'EdDSA')
    return { publicKey: publicKey as CryptoKey, privateKey: privateKey as CryptoKey }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }

  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  const privateJwk = await exportJWK(privateKey)

  mkdirSync(dirname(keyFilePath), { recursive: true })
  writeFileSync(
    keyFilePath,
    JSON.stringify({ publicKey: publicJwk, privateKey: privateJwk }, null, 2),
    { encoding: 'utf-8', mode: 0o600 },
  )

  return { publicKey, privateKey }
}
