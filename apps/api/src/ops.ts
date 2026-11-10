import type { Board, BoardEdge, BoardNode, BoardOp } from './types.js'

const MAX_TEXT = 100_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseNode(value: unknown): BoardNode | null {
  if (!isRecord(value)) return null
  const { id, x, y, html } = value
  if (!isId(id) || !isFiniteNumber(x) || !isFiniteNumber(y)) return null
  if (typeof html !== 'string' || html.length > MAX_TEXT) return null
  return { id, x, y, html }
}

function parseEdge(value: unknown): BoardEdge | null {
  if (!isRecord(value)) return null
  const { id, from, to } = value
  if (!isId(id) || !isId(from) || !isId(to) || from === to) return null
  return { id, from, to }
}

export function parseOp(value: unknown): BoardOp | null {
  if (!isRecord(value)) return null
  if (value.type === 'node.add') {
    const node = parseNode(value.node)
    return node ? { type: 'node.add', node } : null
  }
  if (value.type === 'node.move') {
    if (!isId(value.id) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null
    return { type: 'node.move', id: value.id, x: value.x, y: value.y }
  }
  if (value.type === 'node.remove') {
    if (!isId(value.id)) return null
    return { type: 'node.remove', id: value.id }
  }
  if (value.type === 'edge.add') {
    const edge = parseEdge(value.edge)
    return edge ? { type: 'edge.add', edge } : null
  }
  if (value.type === 'edge.remove') {
    if (!isId(value.id)) return null
    return { type: 'edge.remove', id: value.id }
  }
  return null
}

export function applyOp(board: Board, op: BoardOp): Board | null {
  if (op.type === 'node.add') {
    if (board.nodes.some((node) => node.id === op.node.id)) return null
    return { nodes: [...board.nodes, op.node], edges: board.edges }
  }

  if (op.type === 'node.move') {
    if (!board.nodes.some((node) => node.id === op.id)) return null
    return {
      nodes: board.nodes.map((node) => (node.id === op.id ? { ...node, x: op.x, y: op.y } : node)),
      edges: board.edges,
    }
  }

  if (op.type === 'node.remove') {
    if (!board.nodes.some((node) => node.id === op.id)) return null
    return {
      nodes: board.nodes.filter((node) => node.id !== op.id),
      edges: board.edges.filter((edge) => edge.from !== op.id && edge.to !== op.id),
    }
  }

  if (op.type === 'edge.add') {
    const { edge } = op
    const ids = new Set(board.nodes.map((node) => node.id))
    if (!ids.has(edge.from) || !ids.has(edge.to)) return null
    if (board.edges.some((item) => item.id === edge.id)) return null
    if (board.edges.some((item) => item.from === edge.from && item.to === edge.to)) return null
    return { nodes: board.nodes, edges: [...board.edges, edge] }
  }

  if (!board.edges.some((edge) => edge.id === op.id)) return null
  return { nodes: board.nodes, edges: board.edges.filter((edge) => edge.id !== op.id) }
}
