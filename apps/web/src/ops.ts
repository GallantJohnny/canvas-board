import type { Board, BoardOp } from './types'

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

  if (op.type === 'node.edit') {
    if (!board.nodes.some((node) => node.id === op.id)) return null
    return {
      nodes: board.nodes.map((node) => (node.id === op.id ? { ...node, html: op.html } : node)),
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
