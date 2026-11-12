import { fanout } from './liveBus.js'
import { applyOp } from './ops.js'
import { createSeed } from './seed.js'
import type { Board, BoardOp, BoardSnapshot, Peer } from './types.js'

const PRESENCE_TTL_MS = 45_000

type PresenceEntry = {
  peer: Peer
  expiresAt: number
}

let snapshot: BoardSnapshot = { revision: 0, ...createSeed() }
const presence = new Map<string, PresenceEntry>()
let chain: Promise<unknown> = Promise.resolve()

function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function prunePresence(now = Date.now()) {
  for (const [id, entry] of presence) {
    if (entry.expiresAt <= now) presence.delete(id)
  }
}

export async function memoryGetSnapshot(): Promise<BoardSnapshot> {
  return structuredClone(snapshot)
}

export async function memoryCommitOp(op: BoardOp, clientId: string, opId: string): Promise<BoardSnapshot | null> {
  const committed = await withLock(() => {
    const next = applyOp(snapshot, op)
    if (!next) return null
    snapshot = { revision: snapshot.revision + 1, nodes: next.nodes, edges: next.edges }
    return { snapshot: structuredClone(snapshot), op, clientId, opId }
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

export async function memoryReplaceBoard(next: Board): Promise<BoardSnapshot> {
  const stored = await withLock(() => {
    snapshot = { revision: snapshot.revision + 1, nodes: next.nodes, edges: next.edges }
    return structuredClone(snapshot)
  })
  await fanout({ kind: 'snapshot', revision: stored.revision, nodes: stored.nodes, edges: stored.edges })
  return stored
}

export async function memoryTouchPresence(peer: Peer): Promise<void> {
  presence.set(peer.clientId, { peer: structuredClone(peer), expiresAt: Date.now() + PRESENCE_TTL_MS })
}

export async function memoryDropPresence(clientId: string): Promise<void> {
  presence.delete(clientId)
}

export async function memoryListPeers(): Promise<Peer[]> {
  prunePresence()
  return Array.from(presence.values()).map((entry) => structuredClone(entry.peer))
}

export async function memoryAnnouncePeers(): Promise<Peer[]> {
  const peers = await memoryListPeers()
  await fanout({ kind: 'peers', peers })
  return peers
}
