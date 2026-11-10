import { useEffect, useRef, useState } from 'react'
import { applyOp } from './ops'
import type { Board, BoardEdge, BoardNode, BoardOp, BoardSnapshot, Peer } from './types'

const PALETTE = ['#00539f', '#0b7a4b', '#9a4d0f', '#7a2f8f', '#9f2b4a', '#0e6e8f']
const GUEST_KEY = 'canvas-board-guest'
const NAME_LIMIT = 24
const CURSOR_INTERVAL_MS = 100
const HEARTBEAT_MS = 20_000

type HeldMove = {
  id: string
  x: number
  y: number
  released: boolean
  confirmOpId: string | null
  confirmRevision: number | null
}

type InflightMove = {
  id: string
  opId: string
  x: number
  y: number
}

export type LiveStatus = 'live' | 'connecting' | 'offline'

type Identity = {
  clientId: string
  name: string
  color: string
  chosen: boolean
}

function colorFor(clientId: string) {
  let hash = 0
  for (const char of clientId) hash = (hash + char.charCodeAt(0)) % PALETTE.length
  return PALETTE[hash] ?? PALETTE[0]
}

function readStored(): Partial<Identity> | null {
  try {
    const raw = sessionStorage.getItem(GUEST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Identity>
    return parsed
  } catch {
    return null
  }
}

export function savedName(): string | null {
  const stored = readStored()
  if (!stored?.chosen || typeof stored.name !== 'string') return null
  const name = stored.name.trim()
  return name.length > 0 ? name : null
}

function identityFor(name: string): Identity {
  const stored = readStored()
  const clientId = typeof stored?.clientId === 'string' && stored.clientId.length >= 8 ? stored.clientId : crypto.randomUUID()
  const color = typeof stored?.color === 'string' ? stored.color : colorFor(clientId)
  const identity: Identity = { clientId, name: name.trim().slice(0, NAME_LIMIT), color, chosen: true }
  sessionStorage.setItem(GUEST_KEY, JSON.stringify(identity))
  return identity
}

function isSnapshot(value: unknown): value is BoardSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const snapshot = value as Partial<BoardSnapshot>
  return Array.isArray(snapshot.nodes) && Array.isArray(snapshot.edges) && typeof snapshot.revision === 'number'
}

function peersFrom(value: unknown): Peer[] {
  if (!Array.isArray(value)) return []
  const peers: Peer[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const peer = item as Partial<Peer>
    if (typeof peer.clientId !== 'string' || typeof peer.name !== 'string' || typeof peer.color !== 'string') continue
    peers.push({
      clientId: peer.clientId,
      name: peer.name,
      color: peer.color,
      cursor: peer.cursor === null || isCursor(peer.cursor) ? (peer.cursor ?? null) : null,
    })
  }
  return peers
}

function asOp(value: unknown): BoardOp | null {
  if (typeof value !== 'object' || value === null) return null
  const op = value as BoardOp
  if (op.type === 'node.add' && op.node) return op
  if (op.type === 'node.move' && typeof op.id === 'string') return op
  if (op.type === 'node.edit' && typeof op.id === 'string' && typeof op.html === 'string') return op
  if (op.type === 'node.remove' && typeof op.id === 'string') return op
  if (op.type === 'edge.add' && op.edge) return op
  if (op.type === 'edge.remove' && typeof op.id === 'string') return op
  return null
}

function socketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/board/live`
}

export function useBoardSync(initial: BoardSnapshot, name: string) {
  const [nodes, setNodes] = useState<BoardNode[]>(initial.nodes)
  const [edges, setEdges] = useState<BoardEdge[]>(initial.edges)
  const [peers, setPeers] = useState<Peer[]>([])
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const boardRef = useRef<Board>({ nodes: initial.nodes, edges: initial.edges })
  const revision = useRef(initial.revision)
  const dragging = useRef<string | null>(null)
  const held = useRef<HeldMove | null>(null)
  const inflight = useRef<InflightMove | null>(null)
  const pending = useRef(new Set<string>())
  const socketRef = useRef<WebSocket | null>(null)
  const lastCursor = useRef(0)
  const cursorActive = useRef(false)
  const meRef = useRef<Identity | null>(null)
  if (!meRef.current) meRef.current = identityFor(name)
  const me = meRef.current

  function placeHeld(board: Board): Board {
    const move = held.current
    if (!move) return board
    if (!board.nodes.some((node) => node.id === move.id)) {
      held.current = null
      if (inflight.current?.id === move.id) inflight.current = null
      return board
    }
    return {
      nodes: board.nodes.map((node) => (node.id === move.id ? { ...node, x: move.x, y: move.y } : node)),
      edges: board.edges,
    }
  }

  function setBoard(next: Board) {
    const shown = placeHeld(next)
    boardRef.current = shown
    setNodes(shown.nodes)
    setEdges(shown.edges)
  }

  function takeSnapshot(snapshot: BoardSnapshot) {
    if (snapshot.revision < revision.current) return
    if (held.current?.confirmRevision != null && snapshot.revision >= held.current.confirmRevision) held.current = null
    if (snapshot.revision === revision.current) return
    revision.current = snapshot.revision
    setBoard({ nodes: snapshot.nodes, edges: snapshot.edges })
  }

  function sendOp(op: BoardOp): string | null {
    const opId = crypto.randomUUID()
    pending.current.add(opId)
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      pending.current.delete(opId)
      return null
    }
    socket.send(JSON.stringify({ type: 'op', opId, op }))
    return opId
  }

  function sendHeldMove(asDrop: boolean) {
    const move = held.current
    if (!move || inflight.current) return
    const opId = sendOp({ type: 'node.move', id: move.id, x: move.x, y: move.y })
    if (!opId) return
    inflight.current = { id: move.id, opId, x: move.x, y: move.y }
    if (asDrop) move.confirmOpId = opId
  }

  function noteAck(opId: string, ackRevision: number) {
    pending.current.delete(opId)
    const flight = inflight.current
    const wasFlight = flight?.opId === opId
    if (wasFlight) inflight.current = null
    const move = held.current
    if (!move || (flight?.id !== move.id && move.confirmOpId !== opId)) return
    if (move.confirmOpId === opId) {
      if (ackRevision <= revision.current) held.current = null
      else move.confirmRevision = ackRevision
      return
    }
    if (!wasFlight || !flight) return
    if (move.released || move.x !== flight.x || move.y !== flight.y) sendHeldMove(move.released)
  }

  function rejectMove(opId: string) {
    pending.current.delete(opId)
    const flight = inflight.current
    if (flight?.opId === opId) inflight.current = null
    const move = held.current
    if (move && (move.confirmOpId === opId || flight?.opId === opId)) held.current = null
  }

  function resendHeld() {
    const move = held.current
    if (!move) return
    inflight.current = null
    move.confirmOpId = null
    move.confirmRevision = null
    sendHeldMove(move.released)
  }

  const takeSnapshotRef = useRef(takeSnapshot)
  const noteAckRef = useRef(noteAck)
  const rejectMoveRef = useRef(rejectMove)
  const resendHeldRef = useRef(resendHeld)
  takeSnapshotRef.current = takeSnapshot
  noteAckRef.current = noteAck
  rejectMoveRef.current = rejectMove
  resendHeldRef.current = resendHeld

  useEffect(() => {
    let stopped = false
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let heartbeatTimer = 0
    let delay = 1000
    let refetching = false

    const refetch = async () => {
      if (refetching) return
      refetching = true
      try {
        const response = await fetch('/api/board')
        if (!response.ok) return
        const data: unknown = await response.json()
        if (!isSnapshot(data)) return
        takeSnapshotRef.current(data)
      } catch {
        // The next welcome or op fills the gap.
      } finally {
        refetching = false
      }
    }

    const send = (message: unknown) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(message))
      return true
    }

    const onOp = (message: Record<string, unknown>) => {
      const op = asOp(message.op)
      const opId = message.opId
      if (typeof message.revision !== 'number' || !op || typeof opId !== 'string') return
      if (pending.current.has(opId) && message.revision !== revision.current + 1) {
        noteAckRef.current(opId, message.revision)
        if (message.revision > revision.current) void refetch()
        return
      }
      if (message.revision <= revision.current) return
      if (message.revision !== revision.current + 1) {
        void refetch()
        return
      }
      revision.current = message.revision
      if (pending.current.has(opId)) {
        noteAckRef.current(opId, message.revision)
        return
      }
      if (op.type === 'node.remove' && dragging.current === op.id) dragging.current = null
      const next = applyOp(boardRef.current, op)
      if (!next) {
        void refetch()
        return
      }
      const move = held.current
      const shown =
        move && next.nodes.some((node) => node.id === move.id)
          ? {
              nodes: next.nodes.map((node) => (node.id === move.id ? { ...node, x: move.x, y: move.y } : node)),
              edges: next.edges,
            }
          : next
      if (move && !next.nodes.some((node) => node.id === move.id)) held.current = null
      boardRef.current = shown
      setNodes(shown.nodes)
      setEdges(shown.edges)
    }

    const connect = () => {
      if (stopped) return
      setStatus('connecting')
      const ws = new WebSocket(socketUrl())
      socket = ws
      socketRef.current = ws
      ws.onopen = () => {
        delay = 1000
        setStatus('live')
        ws.send(JSON.stringify({ type: 'hello', ...me }))
        heartbeatTimer = window.setInterval(() => {
          send({ type: 'heartbeat' })
        }, HEARTBEAT_MS)
      }
      ws.onmessage = (event) => {
        const message = parseMessage(event.data)
        if (!message || typeof message.type !== 'string') return
        if (message.type === 'welcome' || message.type === 'snapshot') {
          const kind = message.type
          const peers = message.peers
          if (!isSnapshot(message)) return
          takeSnapshotRef.current(message)
          if (kind === 'welcome') {
            setPeers(peersFrom(peers))
            resendHeldRef.current()
          }
          setStatus('live')
          return
        }
        if (message.type === 'presence') {
          setPeers(peersFrom(message.peers))
          return
        }
        if (message.type === 'cursor' && typeof message.clientId === 'string' && message.clientId !== me.clientId) {
          const clientId = message.clientId
          const cursor = message.cursor === null || isCursor(message.cursor) ? message.cursor : undefined
          if (cursor === undefined) return
          const name = typeof message.name === 'string' ? message.name : 'Guest'
          const color = typeof message.color === 'string' ? message.color : PALETTE[0]
          setPeers((current) => {
            const next = current.filter((peer) => peer.clientId !== clientId)
            next.push({ clientId, name, color, cursor })
            return next
          })
          return
        }
        if (message.type === 'op') onOp(message)
        if (message.type === 'rejected' && typeof message.opId === 'string') rejectMoveRef.current(message.opId)
        if (message.type === 'rejected' || message.type === 'error') void refetch()
      }
      ws.onclose = () => {
        window.clearInterval(heartbeatTimer)
        setStatus('offline')
        if (stopped) return
        reconnectTimer = window.setTimeout(connect, delay)
        delay = Math.min(delay * 2, 30_000)
      }
    }

    connect()
    return () => {
      stopped = true
      window.clearTimeout(reconnectTimer)
      window.clearInterval(heartbeatTimer)
      socket?.close()
    }
  }, [me])

  function mutate(op: BoardOp) {
    const next = applyOp(boardRef.current, op)
    if (!next) return false
    setBoard(next)
    sendOp(op)
    return true
  }

  return {
    nodes,
    edges,
    peers,
    me,
    status,
    setDragged(id: string | null) {
      dragging.current = id
    },
    addNode(node: BoardNode) {
      mutate({ type: 'node.add', node })
    },
    updateNode(id: string, html: string) {
      mutate({ type: 'node.edit', id, html })
    },
    removeNode(id: string) {
      if (dragging.current === id) dragging.current = null
      if (held.current?.id === id) held.current = null
      if (inflight.current?.id === id) inflight.current = null
      mutate({ type: 'node.remove', id })
    },
    addEdge(edge: BoardEdge) {
      mutate({ type: 'edge.add', edge })
    },
    removeEdge(id: string) {
      mutate({ type: 'edge.remove', id })
    },
    previewMove(id: string, x: number, y: number) {
      const next = applyOp(boardRef.current, { type: 'node.move', id, x, y })
      if (!next) return
      held.current = { id, x, y, released: false, confirmOpId: null, confirmRevision: null }
      setBoard(next)
      sendHeldMove(false)
    },
    commitMove(id: string, x: number, y: number) {
      dragging.current = null
      const next = applyOp(boardRef.current, { type: 'node.move', id, x, y })
      if (!next) {
        held.current = null
        return
      }
      const flight = inflight.current
      const sameInflight = flight?.id === id && flight.x === x && flight.y === y
      held.current = {
        id,
        x,
        y,
        released: true,
        confirmOpId: sameInflight ? flight.opId : null,
        confirmRevision: null,
      }
      setBoard(next)
      if (!sameInflight) sendHeldMove(true)
    },
    noteCursor(point: { x: number; y: number } | null) {
      if (!point) {
        if (!cursorActive.current) return
        cursorActive.current = false
      } else {
        const now = performance.now()
        if (cursorActive.current && now - lastCursor.current < CURSOR_INTERVAL_MS) return
        cursorActive.current = true
        lastCursor.current = now
      }
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: 'cursor', x: point?.x ?? null, y: point?.y ?? null }))
    },
  }
}

function parseMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null
  try {
    const value = JSON.parse(data) as unknown
    if (typeof value !== 'object' || value === null) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

function isCursor(value: unknown): value is { x: number; y: number } {
  if (typeof value !== 'object' || value === null) return false
  const cursor = value as { x?: unknown; y?: unknown }
  return typeof cursor.x === 'number' && typeof cursor.y === 'number'
}
