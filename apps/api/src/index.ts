import cors from 'cors'
import express from 'express'
import { getBoard, parseBoard, setBoard } from './boardStore.js'

const app = express()
const port = 3001

app.use(cors())
app.use(express.json())

app.get('/api/board', (_req, res) => {
  res.json(getBoard())
})

// Ready for a later save step. The board UI does not call this yet.
app.put('/api/board', (req, res) => {
  const next = parseBoard(req.body)
  if (!next) {
    res.status(400).json({
      error: 'Expected { nodes: [{ id, x, y, html }], edges: [{ id, from, to }] }',
    })
    return
  }
  setBoard(next)
  res.json(getBoard())
})

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})

server.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
