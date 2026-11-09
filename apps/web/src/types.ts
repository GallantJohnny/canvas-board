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

export type Size = {
  width: number
  height: number
}

export type DraftLink = {
  fromId: string
  x: number
  y: number
}
