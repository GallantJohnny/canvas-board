import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { announcePeers, commitOp, dropPresence, getSnapshot, listPeers, parseOp, touchPresence } from './boardStore.js'
import { emitLocal, onLiveEvent, publishRemote, startSubscription, type LiveEvent } from './liveBus.js'
import type { Peer } from './types.js'

const CURSOR_PUBLISH_MS = 2000
const PALETTE = ['#00539f', '#0b7a4b', '#9a4d0f', '#7a2f8f', '#9f2b4a', '#0e6e8f']

type Client = {
  ws: WebSocket
  clientId: string | null
  name: string
  color: string
  cursor: Peer['cursor']
  lastCursorPublish: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isClientId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 100
}

function colorFor(clientId: string, requested: unknown): string {
  if (typeof requested === 'string' && /^#[0-9a-fA-F]{6}$/.test(requested)) return requested
  let hash = 0
  for (const char of clientId) hash = (hash + char.charCodeAt(0)) % PALETTE.length
  return PALETTE[hash] ?? PALETTE[0]
}

function nameFor(requested: unknown, clientId: string): string {
  if (typeof requested !== 'string') return `Guest ${clientId.slice(0, 4)}`
  const name = requested.trim().slice(0, 24)
  return name.length > 0 ? name : `Guest ${clientId.slice(0, 4)}`
}

function peerOf(client: Client): Peer {
  return {
    clientId: client.clientId ?? '',
    name: client.name,
    color: client.color,
    cursor: client.cursor,
  }
}

function send(ws: WebSocket, message: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

function toClientMessage(event: LiveEvent) {
  if (event.kind === 'op') {
    return { type: 'op', revision: event.revision, op: event.op, clientId: event.clientId, opId: event.opId }
  }
  if (event.kind === 'snapshot') {
    return { type: 'snapshot', revision: event.revision, nodes: event.nodes, edges: event.edges }
  }
  if (event.kind === 'peers') return { type: 'presence', peers: event.peers }
  return {
    type: 'cursor',
    clientId: event.clientId,
    name: event.name,
    color: event.color,
    cursor: event.cursor,
  }
}

function parseCursor(value: unknown): Peer['cursor'] | undefined {
  if (!isRecord(value)) return undefined
  if (value.x === null && value.y === null) return null
  if (typeof value.x !== 'number' || typeof value.y !== 'number') return undefined
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return undefined
  return { x: value.x, y: value.y }
}

export function attachLive(server: Server) {
  const sockets = new Set<Client>()
  startSubscription()
  onLiveEvent((event) => {
    const message = JSON.stringify(toClientMessage(event))
    for (const client of sockets) {
      if (client.ws.readyState === client.ws.OPEN) client.ws.send(message)
    }
  })

  const wss = new WebSocketServer({ server, path: '/api/board/live' })

  wss.on('connection', (ws) => {
    const client: Client = {
      ws,
      clientId: null,
      name: '',
      color: PALETTE[0],
      cursor: null,
      lastCursorPublish: 0,
    }
    sockets.add(client)

    const leave = () => {
      sockets.delete(client)
      if (!client.clientId) return
      const stillHere = [...sockets].some((item) => item.clientId === client.clientId)
      if (stillHere) return
      void dropPresence(client.clientId)
        .then(() => announcePeers())
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Presence update failed'
          console.error(message)
        })
    }

    ws.on('close', leave)
    ws.on('message', (data) => {
      void handleMessage(client, data.toString()).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Live message failed'
        send(ws, { type: 'error', error: message })
      })
    })
  })

  return wss
}

async function handleMessage(client: Client, raw: string) {
  if (raw.length > 500_000) return
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return
  }
  if (!isRecord(value) || typeof value.type !== 'string') return

  if (value.type === 'hello') {
    if (!isClientId(value.clientId)) return
    client.clientId = value.clientId
    client.name = nameFor(value.name, value.clientId)
    client.color = colorFor(value.clientId, value.color)
    await touchPresence(peerOf(client))
    const [snapshot, peers] = await Promise.all([getSnapshot(), listPeers()])
    send(client.ws, {
      type: 'welcome',
      revision: snapshot.revision,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      peers,
    })
    await announcePeers()
    return
  }

  if (!client.clientId) return

  if (value.type === 'heartbeat') {
    await touchPresence(peerOf(client))
    await announcePeers()
    return
  }

  if (value.type === 'op') {
    const op = parseOp(value.op)
    if (!op || typeof value.opId !== 'string' || value.opId.length === 0 || value.opId.length > 100) {
      send(client.ws, { type: 'rejected', opId: typeof value.opId === 'string' ? value.opId : '' })
      return
    }
    const snapshot = await commitOp(op, client.clientId, value.opId)
    if (!snapshot) send(client.ws, { type: 'rejected', opId: value.opId })
    return
  }

  if (value.type === 'cursor') {
    const cursor = parseCursor(value)
    if (cursor === undefined) return
    client.cursor = cursor
    const event: LiveEvent = {
      kind: 'cursor',
      clientId: client.clientId,
      name: client.name,
      color: client.color,
      cursor,
    }
    emitLocal(event)
    const now = Date.now()
    if (cursor === null || now - client.lastCursorPublish >= CURSOR_PUBLISH_MS) {
      client.lastCursorPublish = now
      try {
        await publishRemote(event)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Cursor publish failed'
        console.error(message)
      }
    }
  }
}
