import { createApp } from './app.js'

const port = 3001
const server = createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})

server.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
