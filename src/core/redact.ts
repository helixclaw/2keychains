import { Transform } from 'node:stream'
import type { TransformCallback } from 'node:stream'

const REDACTED = '[REDACTED]'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export class RedactTransform extends Transform {
  private readonly pattern: RegExp | null
  private readonly maxSecretLen: number
  private pending: string

  constructor(secrets: string[]) {
    super({ decodeStrings: true, encoding: 'utf-8' })

    const filtered = secrets.filter((s) => s.length > 0)
    this.pending = ''

    if (filtered.length === 0) {
      this.pattern = null
      this.maxSecretLen = 0
    } else {
      // Sort by length descending so longer secrets match first
      const sorted = [...filtered].sort((a, b) => b.length - a.length)
      this.pattern = new RegExp(sorted.map(escapeRegex).join('|'), 'g')
      this.maxSecretLen = sorted[0].length
    }
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
    if (!this.pattern) {
      this.push(chunk)
      callback()
      return
    }

    this.pending += chunk.toString()
    this.emitSafe()
    callback()
  }

  _flush(callback: TransformCallback) {
    if (this.pending.length > 0) {
      if (this.pattern) {
        this.pattern.lastIndex = 0
        this.push(this.pending.replace(this.pattern, REDACTED))
      } else {
        this.push(this.pending)
      }
      this.pending = ''
    }
    callback()
  }

  /**
   * Scans the pending buffer for secrets and emits as much redacted output
   * as possible, holding back enough tail bytes to handle boundary splits.
   *
   * Strategy: run the regex on the full pending buffer to find all matches,
   * then emit everything up to `safeEnd` (pending.length - maxSecretLen + 1),
   * applying replacements for matches that fall within the emitted portion.
   * Keep the remainder as the new pending buffer.
   */
  private emitSafe(): void {
    if (!this.pattern) return

    const holdBack = this.maxSecretLen - 1
    if (this.pending.length <= holdBack) return

    // safeEnd: we can commit to emitting original chars [0, safeEnd).
    // Any secret starting before safeEnd is guaranteed to be fully visible
    // in pending (since pending has at least safeEnd + holdBack = pending.length chars).
    const safeEnd = this.pending.length - holdBack

    // Find all matches in the full pending buffer
    this.pattern.lastIndex = 0
    const matches: { index: number; length: number }[] = []
    let m: RegExpExecArray | null
    while ((m = this.pattern.exec(this.pending)) !== null) {
      matches.push({ index: m.index, length: m[0].length })
    }

    // Build the output for chars [0, consumedEnd), applying replacements.
    // consumedEnd starts at safeEnd but may extend further if a match that
    // starts before safeEnd extends past it.
    let consumedEnd = safeEnd
    let output = ''
    let cursor = 0
    for (const match of matches) {
      // Only include matches that START before safeEnd
      if (match.index >= safeEnd) break

      // Emit text before this match
      output += this.pending.slice(cursor, match.index)
      output += REDACTED
      cursor = match.index + match.length
      // If the match extends past safeEnd, advance consumedEnd
      if (cursor > consumedEnd) {
        consumedEnd = cursor
      }
    }

    // Emit remaining text up to consumedEnd
    if (cursor < consumedEnd) {
      output += this.pending.slice(cursor, consumedEnd)
    }

    this.pending = this.pending.slice(consumedEnd)
    if (output.length > 0) {
      this.push(output)
    }
  }
}
