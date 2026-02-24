/// <reference types="vitest/globals" />

const mockInstallSkill = vi.fn<() => string>()
const mockUninstallSkill = vi.fn<() => string>()

vi.mock('../core/openclaw.js', () => ({
  installSkill: () => mockInstallSkill(),
  uninstallSkill: () => mockUninstallSkill(),
}))

describe('openclaw install command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    vi.clearAllMocks()
  })

  it('logs success message on successful install', async () => {
    mockInstallSkill.mockReturnValue('Installed: /path/to/skill -> /source')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { openclawCommand } = await import('../cli/openclaw.js')
    await openclawCommand.parseAsync(['install'], { from: 'user' })

    expect(mockInstallSkill).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('Installed: /path/to/skill -> /source')
    expect(process.exitCode).toBeUndefined()
    logSpy.mockRestore()
  })

  it('logs error and sets exitCode=1 on install error', async () => {
    mockInstallSkill.mockImplementation(() => {
      throw new Error('OpenClaw workspace not found')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { openclawCommand } = await import('../cli/openclaw.js')
    await openclawCommand.parseAsync(['install'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('OpenClaw workspace not found')
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })
})

describe('openclaw uninstall command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    vi.clearAllMocks()
  })

  it('logs success message on successful uninstall', async () => {
    mockUninstallSkill.mockReturnValue('Uninstalled: removed /path/to/skill')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { openclawCommand } = await import('../cli/openclaw.js')
    await openclawCommand.parseAsync(['uninstall'], { from: 'user' })

    expect(mockUninstallSkill).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('Uninstalled: removed /path/to/skill')
    expect(process.exitCode).toBeUndefined()
    logSpy.mockRestore()
  })

  it('logs error and sets exitCode=1 on uninstall error', async () => {
    mockUninstallSkill.mockImplementation(() => {
      throw new Error('Not a symlink')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { openclawCommand } = await import('../cli/openclaw.js')
    await openclawCommand.parseAsync(['uninstall'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Not a symlink')
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })
})
