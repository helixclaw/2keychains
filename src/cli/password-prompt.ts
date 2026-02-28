import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'

export function promptPassword(prompt = 'Password: '): Promise<string> {
  return new Promise((resolve) => {
    let muted = false
    const mutableOutput = new Writable({
      write(_chunk, _encoding, callback) {
        if (!muted) process.stderr.write(_chunk)
        callback()
      },
    })

    const rl = createInterface({
      input: process.stdin,
      output: mutableOutput,
      terminal: true,
    })

    process.stderr.write(prompt)
    muted = true

    rl.question('', (answer) => {
      muted = false
      process.stderr.write('\n')
      rl.close()
      resolve(answer)
    })
  })
}
