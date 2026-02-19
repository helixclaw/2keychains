/// <reference types="vitest/globals" />

import { createAccessRequest, RequestLog, type AccessRequest } from '../core/request.js'

describe('createAccessRequest', () => {
  const validArgs = {
    secretUuid: '550e8400-e29b-41d4-a716-446655440000',
    reason: 'Need DB credentials for migration',
    taskRef: 'JIRA-1234',
  }

  describe('happy path', () => {
    it('creates a request with default duration', () => {
      const req = createAccessRequest(validArgs.secretUuid, validArgs.reason, validArgs.taskRef)

      expect(req.id).toBeDefined()
      expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(req.secretUuid).toBe(validArgs.secretUuid)
      expect(req.reason).toBe(validArgs.reason)
      expect(req.taskRef).toBe(validArgs.taskRef)
      expect(req.durationSeconds).toBe(300)
      expect(req.requestedAt).toBeDefined()
      expect(new Date(req.requestedAt).toISOString()).toBe(req.requestedAt)
      expect(req.status).toBe('pending')
    })

    it('creates a request with custom duration', () => {
      const req = createAccessRequest(
        validArgs.secretUuid,
        validArgs.reason,
        validArgs.taskRef,
        600,
      )

      expect(req.durationSeconds).toBe(600)
    })

    it('accepts minimum duration of 30 seconds', () => {
      const req = createAccessRequest(validArgs.secretUuid, validArgs.reason, validArgs.taskRef, 30)

      expect(req.durationSeconds).toBe(30)
    })

    it('accepts maximum duration of 3600 seconds', () => {
      const req = createAccessRequest(
        validArgs.secretUuid,
        validArgs.reason,
        validArgs.taskRef,
        3600,
      )

      expect(req.durationSeconds).toBe(3600)
    })

    it('generates unique ids for each request', () => {
      const req1 = createAccessRequest(validArgs.secretUuid, validArgs.reason, validArgs.taskRef)
      const req2 = createAccessRequest(validArgs.secretUuid, validArgs.reason, validArgs.taskRef)

      expect(req1.id).not.toBe(req2.id)
    })
  })

  describe('validation - secretUuid', () => {
    it('rejects empty secretUuid', () => {
      expect(() => createAccessRequest('', validArgs.reason, validArgs.taskRef)).toThrow(
        'secretUuid is required and must not be empty',
      )
    })

    it('rejects whitespace-only secretUuid', () => {
      expect(() => createAccessRequest('   ', validArgs.reason, validArgs.taskRef)).toThrow(
        'secretUuid is required and must not be empty',
      )
    })
  })

  describe('validation - reason', () => {
    it('rejects empty reason', () => {
      expect(() => createAccessRequest(validArgs.secretUuid, '', validArgs.taskRef)).toThrow(
        'reason is required and must not be empty',
      )
    })

    it('rejects whitespace-only reason', () => {
      expect(() => createAccessRequest(validArgs.secretUuid, '   ', validArgs.taskRef)).toThrow(
        'reason is required and must not be empty',
      )
    })
  })

  describe('validation - taskRef', () => {
    it('rejects empty taskRef', () => {
      expect(() => createAccessRequest(validArgs.secretUuid, validArgs.reason, '')).toThrow(
        'taskRef is required and must not be empty',
      )
    })

    it('rejects whitespace-only taskRef', () => {
      expect(() => createAccessRequest(validArgs.secretUuid, validArgs.reason, '   ')).toThrow(
        'taskRef is required and must not be empty',
      )
    })
  })

  describe('validation - durationSeconds', () => {
    it('rejects duration below 30 seconds', () => {
      expect(() =>
        createAccessRequest(validArgs.secretUuid, validArgs.reason, validArgs.taskRef, 29),
      ).toThrow('durationSeconds must be at least 30')
    })

    it('rejects duration above 3600 seconds', () => {
      expect(() =>
        createAccessRequest(validArgs.secretUuid, validArgs.reason, validArgs.taskRef, 3601),
      ).toThrow('durationSeconds must be at most 3600')
    })

    it('rejects zero duration', () => {
      expect(() =>
        createAccessRequest(validArgs.secretUuid, validArgs.reason, validArgs.taskRef, 0),
      ).toThrow('durationSeconds must be at least 30')
    })

    it('rejects negative duration', () => {
      expect(() =>
        createAccessRequest(validArgs.secretUuid, validArgs.reason, validArgs.taskRef, -1),
      ).toThrow('durationSeconds must be at least 30')
    })
  })
})

describe('RequestLog', () => {
  it('starts empty', () => {
    const log = new RequestLog()

    expect(log.size).toBe(0)
    expect(log.getAll()).toEqual([])
  })

  it('adds and retrieves requests', () => {
    const log = new RequestLog()
    const req = createAccessRequest('secret-1', 'need it', 'TASK-1')

    log.add(req)

    expect(log.size).toBe(1)
    expect(log.getAll()).toEqual([req])
  })

  it('retrieves requests by secretUuid', () => {
    const log = new RequestLog()
    const req1 = createAccessRequest('secret-1', 'reason', 'TASK-1')
    const req2 = createAccessRequest('secret-2', 'reason', 'TASK-2')
    const req3 = createAccessRequest('secret-1', 'another reason', 'TASK-3')

    log.add(req1)
    log.add(req2)
    log.add(req3)

    const filtered = log.getBySecretUuid('secret-1')
    expect(filtered).toHaveLength(2)
    expect(filtered[0]).toEqual(req1)
    expect(filtered[1]).toEqual(req3)
  })

  it('retrieves a request by id', () => {
    const log = new RequestLog()
    const req = createAccessRequest('secret-1', 'reason', 'TASK-1')

    log.add(req)

    expect(log.getById(req.id)).toEqual(req)
    expect(log.getById('nonexistent')).toBeUndefined()
  })

  it('returns a copy from getAll to prevent external mutation', () => {
    const log = new RequestLog()
    const req = createAccessRequest('secret-1', 'reason', 'TASK-1')
    log.add(req)

    const all = log.getAll()
    expect(all).toHaveLength(1)

    // Mutating the returned array should not affect the log
    ;(all as AccessRequest[]).length = 0
    expect(log.getAll()).toHaveLength(1)
  })
})

