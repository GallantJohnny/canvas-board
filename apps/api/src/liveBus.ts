import { Redis } from 'ioredis'
import type { BoardEdge, BoardNode, BoardOp, Peer } from './types.js'

export const CHANNEL = 'board:events'
export const instanceId = crypto.randomUUID()

export type LiveEvent =
  | { kind: 'op'; revision: number; op: BoardOp; clientId: string; opId: string }
  | { kind: 'snapshot'; revision: number; nodes: BoardNode[]; edges: BoardEdge[] }
  | { kind: 'peers'; peers: Peer[] }
  | { kind: 'cursor'; clientId: string; name: string; color: string; cursor: Peer['cursor'] }

const listeners = new Set<(event: LiveEvent) => void>()
let subscriber: Redis | null = null

export function onLiveEvent(listener: (event: LiveEvent) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitLocal(event: LiveEvent) {
  for (const listener of listeners) listener(event)
}

export function redisSocketUrl(): string | null {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!restUrl || !token) return null
  const host = new URL(restUrl).hostname
  return `rediss://default:${encodeURIComponent(token)}@${host}:6379`
}

export async function publishRemote(event: LiveEvent) {
  const { getRedis } = await import('./redis.js')
  await getRedis().publish(CHANNEL, JSON.stringify({ ...event, origin: instanceId }))
}

export async function fanout(event: LiveEvent) {
  emitLocal(event)
  try {
    await publishRemote(event)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publish failed'
    console.error(`Board publish failed: ${message}`)
  }
}

export function startSubscription() {
  if (subscriber) return
  const url = redisSocketUrl()
  if (!url) return
  const client = new Redis(url, {
    connectTimeout: 10_000,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      return Math.min(times * 200, 2000)
    },
  })
  subscriber = client
  client.on('error', (error: Error) => {
    console.error(`Board live subscription error: ${error.message}`)
  })
  client.on('message', (channel: string, payload: string) => {
    if (channel !== CHANNEL) return
    const event = parseRemote(payload)
    if (event) emitLocal(event)
  })
  client.subscribe(CHANNEL).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Subscribe failed'
    console.error(`Board live subscribe failed: ${message}`)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseRemote(payload: string): LiveEvent | null {
  try {
    const value = JSON.parse(payload) as unknown
    if (!isRecord(value) || value.origin === instanceId) return null
    if (value.kind === 'op' || value.kind === 'snapshot' || value.kind === 'peers' || value.kind === 'cursor') {
      return value as LiveEvent
    }
    return null
  } catch {
    return null
  }
}
