/// <reference types="vitest/globals" />

import { RedactTransform } from '../core/redact.js'

/** Helper: write chunks to a transform, collect output, return as string */
function collect(transform: RedactTransform, chunks: (string | Buffer)[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let result = ''
    transform.on('data', (data: Buffer | string) => {
      result += data.toString()
    })
    transform.on('end', () => resolve(result))
    transform.on('error', reject)

    for (const chunk of chunks) {
      transform.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    transform.end()
  })
}

describe('RedactTransform', () => {
  it('replaces a single secret with [REDACTED]', async () => {
    const t = new RedactTransform(['my-secret'])
    const result = await collect(t, ['the value is my-secret here'])
    expect(result).toBe('the value is [REDACTED] here')
  })

  it('replaces multiple different secrets', async () => {
    const t = new RedactTransform(['alpha', 'bravo'])
    const result = await collect(t, ['alpha and bravo are secrets'])
    expect(result).toBe('[REDACTED] and [REDACTED] are secrets')
  })

  it('replaces multiple occurrences of same secret', async () => {
    const t = new RedactTransform(['tok'])
    const result = await collect(t, ['tok appears tok twice tok'])
    expect(result).toBe('[REDACTED] appears [REDACTED] twice [REDACTED]')
  })

  it('handles secret spanning two chunks', async () => {
    const t = new RedactTransform(['boundary'])
    // Split "boundary" across two chunks: "boun" + "dary"
    const result = await collect(t, ['before boun', 'dary after'])
    expect(result).toBe('before [REDACTED] after')
  })

  it('handles secret spanning three chunks', async () => {
    const t = new RedactTransform(['secret123'])
    // Split across three chunks
    const result = await collect(t, ['sec', 'ret1', '23 tail'])
    expect(result).toBe('[REDACTED] tail')
  })

  it('passes through data unchanged when secrets list is empty', async () => {
    const t = new RedactTransform([])
    const result = await collect(t, ['nothing to redact here'])
    expect(result).toBe('nothing to redact here')
  })

  it('passes through data unchanged when no secrets match', async () => {
    const t = new RedactTransform(['xyz'])
    const result = await collect(t, ['nothing matches here'])
    expect(result).toBe('nothing matches here')
  })

  it('handles secrets containing regex special characters (e.g. $, ., *)', async () => {
    const t = new RedactTransform(['price$100.00', 'a*b+c?'])
    const result = await collect(t, ['total: price$100.00 and a*b+c? done'])
    expect(result).toBe('total: [REDACTED] and [REDACTED] done')
  })

  it('flushes buffered tail on stream end', async () => {
    const t = new RedactTransform(['secret'])
    // Send short data that will be entirely buffered as tail
    const result = await collect(t, ['sec', 'ret'])
    expect(result).toBe('[REDACTED]')
  })

  it('handles empty chunks', async () => {
    const t = new RedactTransform(['hidden'])
    const result = await collect(t, ['before ', '', 'hidden', '', ' after'])
    expect(result).toBe('before [REDACTED] after')
  })

  it('handles secret at very start of stream', async () => {
    const t = new RedactTransform(['START'])
    const result = await collect(t, ['START of the line'])
    expect(result).toBe('[REDACTED] of the line')
  })

  it('handles secret at very end of stream', async () => {
    const t = new RedactTransform(['END'])
    const result = await collect(t, ['at the END'])
    expect(result).toBe('at the [REDACTED]')
  })

  it('handles overlapping secret prefixes correctly', async () => {
    const t = new RedactTransform(['abcd', 'abef'])
    const result = await collect(t, ['abcd and abef'])
    expect(result).toBe('[REDACTED] and [REDACTED]')
  })

  it('prefers longer secret match when secrets overlap', async () => {
    const t = new RedactTransform(['pass', 'password'])
    const result = await collect(t, ['my password is set'])
    expect(result).toBe('my [REDACTED] is set')
  })

  it('filters out empty strings from secrets list', async () => {
    const t = new RedactTransform(['', 'real-secret', ''])
    const result = await collect(t, ['the real-secret is here'])
    expect(result).toBe('the [REDACTED] is here')
  })
})
