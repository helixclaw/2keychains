/// <reference types="vitest/globals" />

const mockQuestion = vi.fn()
const mockClose = vi.fn()

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockClose,
  })),
}))

describe('promptPassword', () => {
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stderrWriteSpy.mockRestore()
  })

  it('prompts with default "Password: " message', async () => {
    mockQuestion.mockImplementation((_prompt: string, callback: (answer: string) => void) => {
      callback('secret123')
    })

    const { promptPassword } = await import('../cli/password-prompt.js')
    const result = await promptPassword()

    expect(stderrWriteSpy).toHaveBeenCalledWith('Password: ')
    expect(result).toBe('secret123')
    expect(mockClose).toHaveBeenCalled()
  })

  it('prompts with custom message when provided', async () => {
    mockQuestion.mockImplementation((_prompt: string, callback: (answer: string) => void) => {
      callback('mypassword')
    })

    const { promptPassword } = await import('../cli/password-prompt.js')
    const result = await promptPassword('Enter passphrase: ')

    expect(stderrWriteSpy).toHaveBeenCalledWith('Enter passphrase: ')
    expect(result).toBe('mypassword')
  })

  it('writes newline to stderr after answer', async () => {
    mockQuestion.mockImplementation((_prompt: string, callback: (answer: string) => void) => {
      callback('password')
    })

    const { promptPassword } = await import('../cli/password-prompt.js')
    await promptPassword()

    // Should write prompt first, then newline after answer
    expect(stderrWriteSpy).toHaveBeenCalledWith('Password: ')
    expect(stderrWriteSpy).toHaveBeenCalledWith('\n')
  })

  it('returns empty string when user enters nothing', async () => {
    mockQuestion.mockImplementation((_prompt: string, callback: (answer: string) => void) => {
      callback('')
    })

    const { promptPassword } = await import('../cli/password-prompt.js')
    const result = await promptPassword()

    expect(result).toBe('')
  })
})
