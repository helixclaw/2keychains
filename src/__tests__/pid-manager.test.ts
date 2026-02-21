/// <reference types="vitest/globals" />

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/tmp/test-home'),
}))

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const mockReadFileSync = vi.mocked(readFileSync)
const mockWriteFileSync = vi.mocked(writeFileSync)
const mockUnlinkSync = vi.mocked(unlinkSync)
const mockMkdirSync = vi.mocked(mkdirSync)

describe('PidManager', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('writePid', () => {
    it('writes PID to ~/.2kc/server.pid', async () => {
      const { writePid } = await import('../core/pid-manager.js')
      writePid(12345)

      expect(mockMkdirSync).toHaveBeenCalledWith(join('/tmp/test-home', '.2kc'), {
        recursive: true,
      })
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        join('/tmp/test-home', '.2kc', 'server.pid'),
        '12345',
      )
    })
  })

  describe('readPid', () => {
    it('returns PID number when file exists', async () => {
      mockReadFileSync.mockReturnValue('42')
      const { readPid } = await import('../core/pid-manager.js')

      expect(readPid()).toBe(42)
    })

    it('returns null when file does not exist', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockReadFileSync.mockImplementation(() => {
        throw err
      })
      const { readPid } = await import('../core/pid-manager.js')

      expect(readPid()).toBeNull()
    })

    it('returns null and cleans up when file contains invalid data', async () => {
      mockReadFileSync.mockReturnValue('not-a-number')
      const { readPid } = await import('../core/pid-manager.js')

      expect(readPid()).toBeNull()
      expect(mockUnlinkSync).toHaveBeenCalled()
    })

    it('returns null and cleans up when PID is zero or negative', async () => {
      mockReadFileSync.mockReturnValue('0')
      const { readPid } = await import('../core/pid-manager.js')

      expect(readPid()).toBeNull()
      expect(mockUnlinkSync).toHaveBeenCalled()
    })
  })

  describe('isProcessRunning', () => {
    it('returns true for running process', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      const { isProcessRunning } = await import('../core/pid-manager.js')

      expect(isProcessRunning(12345)).toBe(true)
      expect(killSpy).toHaveBeenCalledWith(12345, 0)
    })

    it('returns false when process.kill throws ESRCH', async () => {
      const err = new Error('ESRCH') as NodeJS.ErrnoException
      err.code = 'ESRCH'
      vi.spyOn(process, 'kill').mockImplementation(() => {
        throw err
      })
      const { isProcessRunning } = await import('../core/pid-manager.js')

      expect(isProcessRunning(99999)).toBe(false)
    })

    it('returns true when process.kill throws EPERM (process exists but no permission)', async () => {
      const err = new Error('EPERM') as NodeJS.ErrnoException
      err.code = 'EPERM'
      vi.spyOn(process, 'kill').mockImplementation(() => {
        throw err
      })
      const { isProcessRunning } = await import('../core/pid-manager.js')

      expect(isProcessRunning(12345)).toBe(true)
    })
  })

  describe('removePidFile', () => {
    it('removes the PID file', async () => {
      const { removePidFile } = await import('../core/pid-manager.js')
      removePidFile()

      expect(mockUnlinkSync).toHaveBeenCalledWith(join('/tmp/test-home', '.2kc', 'server.pid'))
    })

    it('no-ops if file does not exist', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockUnlinkSync.mockImplementation(() => {
        throw err
      })
      const { removePidFile } = await import('../core/pid-manager.js')

      expect(() => removePidFile()).not.toThrow()
    })
  })

  describe('getRunningPid', () => {
    it('returns PID if file exists and process is running', async () => {
      mockReadFileSync.mockReturnValue('12345')
      vi.spyOn(process, 'kill').mockImplementation(() => true)
      const { getRunningPid } = await import('../core/pid-manager.js')

      expect(getRunningPid()).toBe(12345)
    })

    it('returns null and cleans up stale PID file', async () => {
      mockReadFileSync.mockReturnValue('99999')
      const err = new Error('ESRCH') as NodeJS.ErrnoException
      err.code = 'ESRCH'
      vi.spyOn(process, 'kill').mockImplementation(() => {
        throw err
      })
      const { getRunningPid } = await import('../core/pid-manager.js')

      expect(getRunningPid()).toBeNull()
      expect(mockUnlinkSync).toHaveBeenCalled()
    })

    it('returns null if no PID file', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockReadFileSync.mockImplementation(() => {
        throw err
      })
      const { getRunningPid } = await import('../core/pid-manager.js')

      expect(getRunningPid()).toBeNull()
    })
  })

  describe('path constants', () => {
    it('exports correct PID_FILE_PATH', async () => {
      const { PID_FILE_PATH } = await import('../core/pid-manager.js')
      expect(PID_FILE_PATH).toBe(join('/tmp/test-home', '.2kc', 'server.pid'))
    })

    it('exports correct LOG_FILE_PATH', async () => {
      const { LOG_FILE_PATH } = await import('../core/pid-manager.js')
      expect(LOG_FILE_PATH).toBe(join('/tmp/test-home', '.2kc', 'server.log'))
    })
  })
})
