import { generateKeyPairSync, createPublicKey, createPrivateKey } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

interface KeysFileDer {
  publicKey: { type: string; data: string }
  privateKey: { type: string; data: string }
}

export interface ServerKeys {
  publicKey: KeyObject
  privateKey: KeyObject
}

function isValidDerKeysFile(parsed: unknown): parsed is KeysFileDer {
  if (typeof parsed !== 'object' || parsed === null) return false
  const obj = parsed as Record<string, unknown>
  if (typeof obj.publicKey !== 'object' || obj.publicKey === null) return false
  if (typeof obj.privateKey !== 'object' || obj.privateKey === null) return false
  const pub = obj.publicKey as Record<string, unknown>
  const priv = obj.privateKey as Record<string, unknown>
  return typeof pub.data === 'string' && typeof priv.data === 'string'
}

export async function loadOrGenerateKeyPair(keyFilePath: string): Promise<ServerKeys> {
  try {
    const raw = readFileSync(keyFilePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (isValidDerKeysFile(parsed)) {
      const publicKey = createPublicKey({
        key: Buffer.from(parsed.publicKey.data, 'base64'),
        format: 'der',
        type: 'spki',
      })
      const privateKey = createPrivateKey({
        key: Buffer.from(parsed.privateKey.data, 'base64'),
        format: 'der',
        type: 'pkcs8',
      })
      return { publicKey, privateKey }
    }
    // Key file exists but is in an unrecognized format — regenerate
    console.warn(
      `[key-manager] Key file "${keyFilePath}" is in an unrecognized format; regenerating keypair. ` +
        'Previously issued grants or signatures using the old key may become invalid.',
    )
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // File exists but is corrupted (parse error, etc.) — regenerate
      if (err instanceof SyntaxError) {
        console.warn(
          `[key-manager] Key file "${keyFilePath}" is corrupted or not valid JSON; regenerating keypair. ` +
            'Previously issued grants or signatures using the old key may become invalid.',
        )
      } else {
        throw err
      }
    }
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519')

  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' })

  mkdirSync(dirname(keyFilePath), { recursive: true })
  writeFileSync(
    keyFilePath,
    JSON.stringify(
      {
        publicKey: { type: 'spki', data: publicDer.toString('base64') },
        privateKey: { type: 'pkcs8', data: privateDer.toString('base64') },
      },
      null,
      2,
    ),
    { encoding: 'utf-8', mode: 0o600 },
  )

  return { publicKey, privateKey }
}
