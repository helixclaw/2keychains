import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/__tests__/**',
        // Type-only files (no runtime code)
        'src/channels/channel.ts',
        'src/core/types.ts',
        // Entry point glue (low test value)
        'src/cli/index.ts',
        'src/cli/password-prompt.ts',
        'src/server/index.ts',
      ],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
})
