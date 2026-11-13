import { fanout } from './liveBus.js'
import {
  memoryAnnouncePeers,
  memoryCommitOp,
  memoryDropPresence,
  memoryGetSnapshot,
  memoryListPeers,
  memoryReplaceBoard,
  memoryTouchPresence,
} from './memoryStore.js'
import { applyOp, normalizeCardWidth, parseOp } from './ops.js'
import { getRedis } from './redis.js'
import { createSeed } from './seed.js'
import type { Board, BoardOp, BoardSnapshot, Peer } from './types.js'

function useMemory() {
  return !process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN
}

const SNAPSHOT = 'board:snapshot'
const OPS = 'board:ops'
const LOCK = 'board:lock'
const PRESENCE_IDS = 'presence:ids'
const PRESENCE_TTL_SECONDS = 45

export { parseOp }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseSnapshot(value: unknown): BoardSnapshot | null {
  const board = parseBoard(value)
  if (!board || !isRecord(value)) return null
  const { revision } = value
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null
  return { revision, nodes: board.nodes, edges: board.edges }
}

function presenceKey(clientId: string) {
  return `presence:${clientId}`
}

function parsePeer(value: unknown): Peer | null {
  if (!isRecord(value)) return null
  const { clientId, name, color, cursor } = value
  if (typeof clientId !== 'string' || typeof name !== 'string' || typeof color !== 'string') return null
  if (cursor === null) return { clientId, name, color, cursor: null }
  if (!isRecord(cursor) || typeof cursor.x !== 'number' || typeof cursor.y !== 'number') return null
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null
  return { clientId, name, color, cursor: { x: cursor.x, y: cursor.y } }
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const redis = getRedis()
  const token = crypto.randomUUID()
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const acquired = await redis.set(LOCK, token, { nx: true, px: 3000 })
    if (acquired) {
      try {
        return await fn()
      } finally {
        const current = await redis.get<string>(LOCK)
        if (current === token) await redis.del(LOCK)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error('Board is busy')
}

async function loadSnapshot(): Promise<BoardSnapshot | null> {
  return parseSnapshot(await getRedis().get<unknown>(SNAPSHOT))
}

async function ensureSnapshot(): Promise<BoardSnapshot> {
  const existing = await loadSnapshot()
  if (existing) return existing
  const seeded: BoardSnapshot = { revision: 0, ...createSeed() }
  await getRedis().set(SNAPSHOT, seeded)
  return seeded
}

export async function getSnapshot(): Promise<BoardSnapshot> {
  if (useMemory()) return memoryGetSnapshot()
  const existing = await loadSnapshot()
  if (existing) return existing
  return withLock(ensureSnapshot)
}

export async function commitOp(op: BoardOp, clientId: string, opId: string): Promise<BoardSnapshot | null> {
  if (useMemory()) return memoryCommitOp(op, clientId, opId)
  const committed = await withLock(async () => {
    const current = await ensureSnapshot()
    const next = applyOp(current, op)
    if (!next) return null
    const snapshot: BoardSnapshot = { revision: current.revision + 1, nodes: next.nodes, edges: next.edges }
    const redis = getRedis()
    await redis.set(SNAPSHOT, snapshot)
    await redis.rpush(OPS, { revision: snapshot.revision, op, clientId, opId })
    await redis.ltrim(OPS, -500, -1)
    return { snapshot, op, clientId, opId }
  })
  if (!committed) return null
  await fanout({
    kind: 'op',
    revision: committed.snapshot.revision,
    op: committed.op,
    clientId: committed.clientId,
    opId: committed.opId,
  })
  return committed.snapshot
}

export async function replaceBoard(next: Board): Promise<BoardSnapshot> {
  if (useMemory()) return memoryReplaceBoard(next)
  const snapshot = await withLock(async () => {
    const current = await ensureSnapshot()
    const stored: BoardSnapshot = { revision: current.revision + 1, nodes: next.nodes, edges: next.edges }
    await getRedis().set(SNAPSHOT, stored)
    return stored
  })
  await fanout({ kind: 'snapshot', revision: snapshot.revision, nodes: snapshot.nodes, edges: snapshot.edges })
  return snapshot
}

export async function touchPresence(peer: Peer): Promise<void> {
  if (useMemory()) return memoryTouchPresence(peer)
  const redis = getRedis()
  await Promise.all([
    redis.set(presenceKey(peer.clientId), peer, { ex: PRESENCE_TTL_SECONDS }),
    redis.sadd(PRESENCE_IDS, peer.clientId),
  ])
}

export async function dropPresence(clientId: string): Promise<void> {
  if (useMemory()) return memoryDropPresence(clientId)
  const redis = getRedis()
  await Promise.all([redis.del(presenceKey(clientId)), redis.srem(PRESENCE_IDS, clientId)])
}

export async function listPeers(): Promise<Peer[]> {
  if (useMemory()) return memoryListPeers()
  const redis = getRedis()
  const ids = await redis.smembers(PRESENCE_IDS)
  if (ids.length === 0) return []
  const values = await redis.mget<(Peer | null)[]>(...ids.map(presenceKey))
  const peers: Peer[] = []
  const stale: string[] = []
  ids.forEach((id, index) => {
    const peer = parsePeer(values[index])
    if (!peer) stale.push(id)
    else peers.push(peer)
  })
  if (stale.length > 0) await redis.srem(PRESENCE_IDS, ...stale)
  return peers
}

export async function announcePeers(): Promise<Peer[]> {
  if (useMemory()) return memoryAnnouncePeers()
  const peers = await listPeers()
  await fanout({ kind: 'peers', peers })
  return peers
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseBoard(value: unknown): Board | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null

  const nodes: Board['nodes'] = []
  const ids = new Set<string>()
  for (const item of value.nodes) {
    if (!isRecord(item)) return null
    const { id, x, y, html } = item
    if (typeof id !== 'string' || id.length === 0) return null
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null
    if (typeof html !== 'string') return null
    if (item.width !== undefined && normalizeCardWidth(item.width) === undefined) return null
    if (ids.has(id)) return null
    ids.add(id)
    const width = normalizeCardWidth(item.width)
    nodes.push(width === undefined ? { id, x, y, html } : { id, x, y, html, width })
  }

  const edges: Board['edges'] = []
  const edgeIds = new Set<string>()
  const pairs = new Set<string>()
  for (const item of value.edges) {
    if (!isRecord(item)) return null
    const { id, from, to } = item
    if (typeof id !== 'string' || id.length === 0) return null
    if (typeof from !== 'string' || typeof to !== 'string') return null
    if (from === to || !ids.has(from) || !ids.has(to)) return null
    if (edgeIds.has(id)) return null
    const pair = `${from}\0${to}`
    if (pairs.has(pair)) return null
    edgeIds.add(id)
    pairs.add(pair)
    edges.push({ id, from, to })
  }

  return { nodes, edges }
}
