import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SecretStore } from '../core/secret-store.js'

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('SecretStore', () => {
  let tmpDir: string
  let filePath: string
  let store: SecretStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), '2kc-test-'))
    filePath = join(tmpDir, 'secrets.json')
    store = new SecretStore(filePath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('add', () => {
    it('should create a secret with a valid UUIDv4', () => {
      const uuid = store.add('my-secret', 's3cret')
      expect(uuid).toMatch(UUID_V4_REGEX)
    })

    it('should store ref, value, tags, createdAt, updatedAt', () => {
      const uuid = store.add('my-secret', 's3cret', ['api', 'prod'])
      const metadata = store.getMetadata(uuid)
      expect(metadata.ref).toBe('my-secret')
      expect(metadata.tags).toEqual(['api', 'prod'])
      expect(store.getValue(uuid)).toBe('s3cret')
    })

    it('should default tags to empty array when not provided', () => {
      const uuid = store.add('my-secret', 's3cret')
      const metadata = store.getMetadata(uuid)
      expect(metadata.tags).toEqual([])
    })

    it('should return the generated UUID', () => {
      const uuid = store.add('my-secret', 's3cret')
      expect(typeof uuid).toBe('string')
      expect(uuid.length).toBeGreaterThan(0)
    })

    it('should throw when adding a secret with a duplicate ref', () => {
      store.add('my-secret', 'value1')
      expect(() => store.add('my-secret', 'value2')).toThrow(
        'A secret with the ref "my-secret" already exists',
      )
    })

    it('should allow different refs', () => {
      store.add('secret-a', 'value1')
      const uuid = store.add('secret-b', 'value2')
      expect(uuid).toMatch(UUID_V4_REGEX)
    })
  })

  describe('ref validation', () => {
    it('should reject refs with uppercase letters', () => {
      expect(() => store.add('My-Secret', 'value')).toThrow('Invalid ref')
    })

    it('should reject refs with leading hyphens', () => {
      expect(() => store.add('-my-secret', 'value')).toThrow('Invalid ref')
    })

    it('should reject refs with trailing hyphens', () => {
      expect(() => store.add('my-secret-', 'value')).toThrow('Invalid ref')
    })

    it('should reject empty string ref', () => {
      expect(() => store.add('', 'value')).toThrow('Invalid ref')
    })

    it('should reject refs with special characters (spaces, underscores, etc.)', () => {
      expect(() => store.add('my secret', 'value')).toThrow('Invalid ref')
      expect(() => store.add('my_secret', 'value')).toThrow('Invalid ref')
      expect(() => store.add('my@secret', 'value')).toThrow('Invalid ref')
    })

    it('should accept valid slug like "my-api-key"', () => {
      const uuid = store.add('my-api-key', 'value')
      expect(uuid).toMatch(UUID_V4_REGEX)
    })

    it('should accept single character ref like "a"', () => {
      const uuid = store.add('a', 'value')
      expect(uuid).toMatch(UUID_V4_REGEX)
    })

    it('should accept two character ref like "ab"', () => {
      const uuid = store.add('ab', 'value')
      expect(uuid).toMatch(UUID_V4_REGEX)
    })

    it('should accept numeric refs', () => {
      const uuid = store.add('123', 'value')
      expect(uuid).toMatch(UUID_V4_REGEX)
    })

    it('should reject refs that look like UUIDs', () => {
      expect(() => store.add('550e8400-e29b-41d4-a716-446655440000', 'value')).toThrow(
        'Refs must not look like UUIDs',
      )
    })
  })

  describe('list', () => {
    it('should return uuid, ref, and tags for each secret', () => {
      store.add('secret-1', 'val1', ['tag-a'])
      store.add('secret-2', 'val2', ['tag-b'])

      const items = store.list()
      expect(items).toHaveLength(2)
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(['ref', 'tags', 'uuid'])
      }
    })

    it('should return empty array when no secrets exist', () => {
      const items = store.list()
      expect(items).toEqual([])
    })
  })

  describe('remove', () => {
    it('should remove a secret by UUID', () => {
      const uuid = store.add('my-secret', 's3cret')
      expect(store.list()).toHaveLength(1)

      store.remove(uuid)
      expect(store.list()).toHaveLength(0)
    })

    it('should throw for non-existent UUID', () => {
      expect(() => store.remove('non-existent-uuid')).toThrow(
        'Secret with UUID non-existent-uuid not found',
      )
    })
  })

  describe('getMetadata', () => {
    it('should return uuid, tags, and ref but NOT value', () => {
      const uuid = store.add('my-secret', 's3cret', ['tag1'])
      const metadata = store.getMetadata(uuid)

      expect(metadata).toEqual({
        uuid,
        ref: 'my-secret',
        tags: ['tag1'],
      })
      expect(metadata).not.toHaveProperty('value')
    })

    it('should throw for non-existent UUID', () => {
      expect(() => store.getMetadata('non-existent-uuid')).toThrow(
        'Secret with UUID non-existent-uuid not found',
      )
    })
  })

  describe('getValue', () => {
    it('should return the secret value for a valid UUID', () => {
      const uuid = store.add('my-secret', 's3cret')
      expect(store.getValue(uuid)).toBe('s3cret')
    })

    it('should throw for non-existent UUID', () => {
      expect(() => store.getValue('non-existent-uuid')).toThrow(
        'Secret with UUID non-existent-uuid not found',
      )
    })
  })

  describe('getByRef', () => {
    it('should return metadata for existing ref', () => {
      const uuid = store.add('my-api-key', 'secret-value', ['prod'])
      const metadata = store.getByRef('my-api-key')

      expect(metadata).toEqual({
        uuid,
        ref: 'my-api-key',
        tags: ['prod'],
      })
      expect(metadata).not.toHaveProperty('value')
    })

    it('should throw for non-existent ref', () => {
      expect(() => store.getByRef('does-not-exist')).toThrow(
        'Secret with ref "does-not-exist" not found',
      )
    })
  })

  describe('getValueByRef', () => {
    it('should return value for existing ref', () => {
      store.add('my-api-key', 'secret-value')
      expect(store.getValueByRef('my-api-key')).toBe('secret-value')
    })

    it('should throw for non-existent ref', () => {
      expect(() => store.getValueByRef('does-not-exist')).toThrow(
        'Secret with ref "does-not-exist" not found',
      )
    })
  })

  describe('resolve', () => {
    it('should resolve a UUID to metadata', () => {
      const uuid = store.add('my-secret', 'value', ['tag1'])
      const metadata = store.resolve(uuid)

      expect(metadata).toEqual({
        uuid,
        ref: 'my-secret',
        tags: ['tag1'],
      })
    })

    it('should resolve a ref to metadata', () => {
      const uuid = store.add('my-secret', 'value', ['tag1'])
      const metadata = store.resolve('my-secret')

      expect(metadata).toEqual({
        uuid,
        ref: 'my-secret',
        tags: ['tag1'],
      })
    })

    it('should throw for unknown ref-or-UUID', () => {
      expect(() => store.resolve('unknown-ref')).toThrow('Secret with ref "unknown-ref" not found')
    })

    it('should throw for unknown UUID', () => {
      expect(() => store.resolve('00000000-0000-0000-0000-000000000000')).toThrow(
        'Secret with UUID 00000000-0000-0000-0000-000000000000 not found',
      )
    })
  })

  describe('file handling', () => {
    it('should create the JSON file on first write if it does not exist', () => {
      const newPath = join(tmpDir, 'new-secrets.json')
      const newStore = new SecretStore(newPath)
      newStore.add('test', 'value')

      const stats = statSync(newPath)
      expect(stats.isFile()).toBe(true)
    })

    it('should create parent directories if they do not exist', () => {
      const nestedPath = join(tmpDir, 'a', 'b', 'c', 'secrets.json')
      const nestedStore = new SecretStore(nestedPath)
      nestedStore.add('test', 'value')

      const stats = statSync(nestedPath)
      expect(stats.isFile()).toBe(true)
    })

    it('should set file permissions to 0600', () => {
      store.add('test', 'value')

      const stats = statSync(filePath)

      const mode = stats.mode & 0o777
      expect(mode).toBe(0o600)
    })

    it('should throw a descriptive error when the secrets file is corrupted', () => {
      writeFileSync(filePath, 'not valid json{{{', 'utf-8')
      expect(() => store.list()).toThrow(
        `Failed to parse secrets file at ${filePath}. File may be corrupted.`,
      )
    })

    it('should persist secrets across store instances (reload from file)', () => {
      const uuid = store.add('my-secret', 's3cret', ['tag1'])

      const store2 = new SecretStore(filePath)
      const items = store2.list()
      expect(items).toHaveLength(1)
      expect(items[0].uuid).toBe(uuid)
      expect(store2.getValue(uuid)).toBe('s3cret')
    })
  })
})
