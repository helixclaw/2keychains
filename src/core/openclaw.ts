import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const SKILL_NAME = '2keychains'

function defaultWorkspaceDir(): string {
  return join(homedir(), '.openclaw', 'workspace')
}

function defaultSkillSourceDir(): string {
  return resolve(import.meta.dirname, '..', '..', 'skill')
}

export interface OpenclawOptions {
  workspaceDir?: string
  skillSourceDir?: string
}

export function installSkill(opts?: OpenclawOptions): string {
  const workspaceDir = opts?.workspaceDir ?? defaultWorkspaceDir()
  const skillSourceDir = opts?.skillSourceDir ?? defaultSkillSourceDir()

  if (!existsSync(workspaceDir)) {
    throw new Error(`OpenClaw workspace not found at ${workspaceDir}. Is OpenClaw installed?`)
  }

  const skillsDir = join(workspaceDir, 'skills')
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true })
  }

  const symlinkPath = join(skillsDir, SKILL_NAME)

  const stat = lstatSync(symlinkPath, { throwIfNoEntry: false })
  if (stat) {
    if (!stat.isSymbolicLink()) {
      throw new Error(
        `${symlinkPath} exists but is not a symlink. Remove it manually if you want to reinstall.`,
      )
    }

    const currentTarget = readlinkSync(symlinkPath)
    if (resolve(currentTarget) === resolve(skillSourceDir)) {
      return `Already installed: ${symlinkPath} -> ${skillSourceDir}`
    }

    throw new Error(
      `${symlinkPath} is a symlink pointing to ${currentTarget}, not ${skillSourceDir}. Remove it manually if you want to reinstall.`,
    )
  }

  if (!existsSync(skillSourceDir)) {
    throw new Error(`Skill source directory not found at ${skillSourceDir}.`)
  }

  symlinkSync(skillSourceDir, symlinkPath)
  return `Installed: ${symlinkPath} -> ${skillSourceDir}`
}

export function uninstallSkill(opts?: OpenclawOptions): string {
  const workspaceDir = opts?.workspaceDir ?? defaultWorkspaceDir()

  if (!existsSync(workspaceDir)) {
    throw new Error(`OpenClaw workspace not found at ${workspaceDir}. Is OpenClaw installed?`)
  }

  const skillsDir = join(workspaceDir, 'skills')
  const symlinkPath = join(skillsDir, SKILL_NAME)

  const stat = lstatSync(symlinkPath, { throwIfNoEntry: false })
  if (!stat) {
    return `Not installed: ${symlinkPath} does not exist`
  }

  if (!stat.isSymbolicLink()) {
    throw new Error(`${symlinkPath} exists but is not a symlink. Remove it manually.`)
  }

  unlinkSync(symlinkPath)
  return `Uninstalled: removed ${symlinkPath}`
}
