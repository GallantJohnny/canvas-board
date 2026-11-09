import { createSeed } from './seed.js'
import type { Board, BoardEdge, BoardNode } from './types.js'

let board: Board = structuredClone(createSeed())

export function getBoard(): Board {
  return structuredClone(board)
}

export function setBoard(next: Board): void {
  board = structuredClone(next)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseBoard(value: unknown): Board | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null

  const nodes: BoardNode[] = []
  const ids = new Set<string>()
  for (const item of value.nodes) {
    if (!isRecord(item)) return null
    const { id, x, y, html } = item
    if (typeof id !== 'string' || id.length === 0) return null
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null
    if (typeof html !== 'string') return null
    if (ids.has(id)) return null
    ids.add(id)
    nodes.push({ id, x, y, html })
  }

  const edges: BoardEdge[] = []
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
