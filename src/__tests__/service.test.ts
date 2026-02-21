import { describe, it, expect } from 'vitest'

import { resolveService, LocalService } from '../core/service.js'
import { RemoteService } from '../core/remote-service.js'
import { defaultConfig } from '../core/config.js'

describe('resolveService', () => {
  it('returns LocalService for standalone mode', () => {
    const config = defaultConfig()
    const service = resolveService(config)
    expect(service).toBeInstanceOf(LocalService)
  })

  it('returns RemoteService for client mode', () => {
    const config = {
      ...defaultConfig(),
      mode: 'client' as const,
      server: { host: '127.0.0.1', port: 2274, authToken: 'test-token' },
    }
    const service = resolveService(config)
    expect(service).toBeInstanceOf(RemoteService)
  })
})

describe('LocalService', () => {
  it('health throws not implemented', async () => {
    const service = new LocalService()
    await expect(service.health()).rejects.toThrow('not implemented')
  })

  it('secrets.list throws not implemented', async () => {
    const service = new LocalService()
    await expect(service.secrets.list()).rejects.toThrow('not implemented')
  })

  it('secrets.add throws not implemented', async () => {
    const service = new LocalService()
    await expect(service.secrets.add('name', 'value')).rejects.toThrow('not implemented')
  })

  it('secrets.remove throws not implemented', async () => {
    const service = new LocalService()
    await expect(service.secrets.remove('uuid')).rejects.toThrow('not implemented')
  })

  it('secrets.getMetadata throws not implemented', async () => {
    const service = new LocalService()
    await expect(service.secrets.getMetadata('uuid')).rejects.toThrow('not implemented')
  })

  it('requests.create throws not implemented', async () => {
    const service = new LocalService()
    await expect(service.requests.create('uuid', 'reason', 'task')).rejects.toThrow(
      'not implemented',
    )
  })

  it('grants.validate throws not implemented', async () => {
    const service = new LocalService()
    await expect(service.grants.validate('grantId')).rejects.toThrow('not implemented')
  })

  it('inject throws not implemented', async () => {
    const service = new LocalService()
    await expect(service.inject('grantId', 'VAR', 'cmd')).rejects.toThrow('not implemented')
  })
})
