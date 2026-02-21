import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  readlinkSync,
  lstatSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { installSkill, uninstallSkill } from '../core/openclaw.js'

describe('openclaw install/uninstall', () => {
  let tmpDir: string
  let workspaceDir: string
  let skillSourceDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), '2kc-openclaw-test-'))
    workspaceDir = join(tmpDir, 'workspace')
    skillSourceDir = join(tmpDir, 'skill')

    // Create the workspace and skill source directories
    mkdirSync(workspaceDir, { recursive: true })
    mkdirSync(skillSourceDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('installSkill', () => {
    it('should create a symlink from skills/2keychains to the skill source', () => {
      const result = installSkill({ workspaceDir, skillSourceDir })

      expect(result).toContain('Installed:')
      const symlinkPath = join(workspaceDir, 'skills', '2keychains')
      const stat = lstatSync(symlinkPath)
      expect(stat.isSymbolicLink()).toBe(true)
      expect(readlinkSync(symlinkPath)).toBe(skillSourceDir)
    })

    it('should create the skills/ subdirectory if it does not exist', () => {
      installSkill({ workspaceDir, skillSourceDir })

      const symlinkPath = join(workspaceDir, 'skills', '2keychains')
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true)
    })

    it('should throw when workspace directory does not exist', () => {
      const missingWorkspace = join(tmpDir, 'nonexistent')

      expect(() => installSkill({ workspaceDir: missingWorkspace, skillSourceDir })).toThrow(
        'OpenClaw workspace not found',
      )
    })

    it('should succeed idempotently when symlink already points to correct target', () => {
      installSkill({ workspaceDir, skillSourceDir })
      const result = installSkill({ workspaceDir, skillSourceDir })

      expect(result).toContain('Already installed:')
    })

    it('should throw when target exists but is not a symlink', () => {
      const skillsDir = join(workspaceDir, 'skills')
      mkdirSync(skillsDir, { recursive: true })
      const targetPath = join(skillsDir, '2keychains')
      mkdirSync(targetPath)

      expect(() => installSkill({ workspaceDir, skillSourceDir })).toThrow(
        'exists but is not a symlink',
      )
    })

    it('should throw when symlink exists but points to a different location', () => {
      const skillsDir = join(workspaceDir, 'skills')
      mkdirSync(skillsDir, { recursive: true })
      const otherDir = join(tmpDir, 'other-skill')
      mkdirSync(otherDir)
      symlinkSync(otherDir, join(skillsDir, '2keychains'))

      expect(() => installSkill({ workspaceDir, skillSourceDir })).toThrow(
        'is a symlink pointing to',
      )
    })

    it('should throw when skill source directory does not exist', () => {
      const missingSource = join(tmpDir, 'missing-skill')

      expect(() => installSkill({ workspaceDir, skillSourceDir: missingSource })).toThrow(
        'Skill source directory not found',
      )
    })

    it('should throw when target is a regular file, not a symlink', () => {
      const skillsDir = join(workspaceDir, 'skills')
      mkdirSync(skillsDir, { recursive: true })
      writeFileSync(join(skillsDir, '2keychains'), 'not a symlink')

      expect(() => installSkill({ workspaceDir, skillSourceDir })).toThrow(
        'exists but is not a symlink',
      )
    })
  })

  describe('uninstallSkill', () => {
    it('should remove the symlink', () => {
      installSkill({ workspaceDir, skillSourceDir })
      const result = uninstallSkill({ workspaceDir })

      expect(result).toContain('Uninstalled:')
      const symlinkPath = join(workspaceDir, 'skills', '2keychains')
      expect(lstatSync(symlinkPath, { throwIfNoEntry: false })).toBeUndefined()
    })

    it('should succeed idempotently when symlink does not exist', () => {
      const result = uninstallSkill({ workspaceDir })

      expect(result).toContain('Not installed:')
    })

    it('should throw when workspace directory does not exist', () => {
      const missingWorkspace = join(tmpDir, 'nonexistent')

      expect(() => uninstallSkill({ workspaceDir: missingWorkspace })).toThrow(
        'OpenClaw workspace not found',
      )
    })

    it('should throw when target exists but is not a symlink', () => {
      const skillsDir = join(workspaceDir, 'skills')
      mkdirSync(skillsDir, { recursive: true })
      mkdirSync(join(skillsDir, '2keychains'))

      expect(() => uninstallSkill({ workspaceDir })).toThrow('exists but is not a symlink')
    })
  })
})
