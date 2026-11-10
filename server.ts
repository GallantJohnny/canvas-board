import { existsSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createApp } from './apps/api/src/app.js'
import { attachLive } from './apps/api/src/live.js'
import { loadLocalEnv } from './apps/api/src/loadEnv.js'

loadLocalEnv()

const app = createApp()
const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'apps', 'web', 'dist')

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next()
    return
  }

  const requested = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '')
  const file = path.resolve(webRoot, requested)
  const relative = path.relative(webRoot, file)
  if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(file)) {
    next()
    return
  }

  // Packaged files share one old timestamp, so the default validator keeps a stale
  // index.html that points at a script from a previous deploy.
  const hashedAsset = requested.startsWith('assets/')
  res.setHeader('Cache-Control', hashedAsset ? 'public, max-age=31536000, immutable' : 'no-store')
  res.sendFile(file, { etag: false, lastModified: false, cacheControl: false })
})

if (typeof express !== 'function') {
  throw new Error('Express did not load')
}

const server = http.createServer(app)
attachLive(server)

export default server
