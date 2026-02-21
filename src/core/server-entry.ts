// Server entry point for the forked daemon process.
// This is a minimal HTTP server with a /health endpoint.
// It will be replaced/extended by #17 (HTTP server foundation).

import http from 'node:http'

import { loadConfig } from './config.js'

const config = loadConfig()

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        status: 'ok',
        pid: process.pid,
        uptime: process.uptime(),
      }),
    )
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(config.server.port, config.server.host, () => {
  console.log(`Server listening on ${config.server.host}:${config.server.port}`)
})

// Graceful shutdown on SIGTERM
process.on('SIGTERM', () => {
  setTimeout(() => process.exit(1), 3000).unref()
  server.close(() => {
    process.exit(0)
  })
})
