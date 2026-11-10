import cors from 'cors'
import express from 'express'
import { getSnapshot, parseBoard, replaceBoard } from './boardStore.js'
import { BoardStoreError } from './redis.js'

export function createApp() {
  const app = express()

  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/board', async (_req, res) => {
    try {
      res.json(await getSnapshot())
    } catch (error) {
      res.status(503).json({ error: storeError(error) })
    }
  })

  app.put('/api/board', async (req, res) => {
    const next = parseBoard(req.body)
    if (!next) {
      res.status(400).json({
        error: 'Expected { nodes: [{ id, x, y, html }], edges: [{ id, from, to }] }',
      })
      return
    }
    try {
      res.json(await replaceBoard(next))
    } catch (error) {
      res.status(503).json({ error: storeError(error) })
    }
  })

  return app
}

function storeError(error: unknown): string {
  if (error instanceof BoardStoreError) return error.message
  return 'The board store is unavailable.'
}
