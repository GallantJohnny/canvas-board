import http from 'node:http'
import { createApp } from './app.js'
import { attachLive } from './live.js'
import { loadLocalEnv } from './loadEnv.js'

loadLocalEnv()

const port = 3001
const server = http.createServer(createApp())
attachLive(server)

server.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})

server.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
