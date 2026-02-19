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

    it('should store name, value, tags, createdAt, updatedAt', () => {
      const uuid = store.add('my-secret', 's3cret', ['api', 'prod'])
      const metadata = store.getMetadata(uuid)
      expect(metadata.name).toBe('my-secret')
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

    it('should throw when adding a secret with a duplicate name', () => {
      store.add('my-secret', 'value1')
      expect(() => store.add('my-secret', 'value2')).toThrow(
        'A secret with the name "my-secret" already exists',
      )
    })

    it('should allow different names', () => {
      store.add('secret-a', 'value1')
      const uuid = store.add('secret-b', 'value2')
      expect(uuid).toMatch(UUID_V4_REGEX)
    })
  })

  describe('list', () => {
    it('should return only uuid and tags for each secret', () => {
      store.add('secret-1', 'val1', ['tag-a'])
      store.add('secret-2', 'val2', ['tag-b'])

      const items = store.list()
      expect(items).toHaveLength(2)
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(['tags', 'uuid'])
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
    it('should return uuid, tags, and name but NOT value', () => {
      const uuid = store.add('my-secret', 's3cret', ['tag1'])
      const metadata = store.getMetadata(uuid)

      expect(metadata).toEqual({
        uuid,
        name: 'my-secret',
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
