export type BoardNode = {
  id: string
  x: number
  y: number
  html: string
}

export type BoardEdge = {
  id: string
  from: string
  to: string
}

export type Board = {
  nodes: BoardNode[]
  edges: BoardEdge[]
}

export type BoardSnapshot = Board & {
  revision: number
}

export type BoardOp =
  | { type: 'node.add'; node: BoardNode }
  | { type: 'node.move'; id: string; x: number; y: number }
  | { type: 'node.edit'; id: string; html: string }
  | { type: 'node.remove'; id: string }
  | { type: 'edge.add'; edge: BoardEdge }
  | { type: 'edge.remove'; id: string }

export type PeerCursor = {
  x: number
  y: number
}

export type Peer = {
  clientId: string
  name: string
  color: string
  cursor: PeerCursor | null
}
