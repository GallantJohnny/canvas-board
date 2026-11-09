import { anchor, curve } from './geometry'
import type { BoardEdge, BoardNode, DraftLink, Size } from './types'

type Props = {
  nodes: BoardNode[]
  edges: BoardEdge[]
  sizes: Record<string, Size>
  draft: DraftLink | null
  onRemove: (id: string) => void
}

export function Edges({ nodes, edges, sizes, draft, onRemove }: Props) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const draftFrom = draft ? byId.get(draft.fromId) : undefined
  const draftStart = draftFrom ? anchor(draftFrom, sizes[draftFrom.id], 'right') : null

  return (
    <svg className="edges" aria-hidden="true">
      {edges.map((edge) => {
        const from = byId.get(edge.from)
        const to = byId.get(edge.to)
        if (!from || !to) return null
        const start = anchor(from, sizes[from.id], 'right')
        const end = anchor(to, sizes[to.id], 'left')
        const d = curve(start.x, start.y, end.x, end.y)
        return (
          <g key={edge.id}>
            <path className="edge-line" d={d} />
            <path
              className="edge-hit"
              data-edge-id={edge.id}
              d={d}
              onClick={() => onRemove(edge.id)}
            />
          </g>
        )
      })}
      {draft && draftStart ? (
        <path className="edge-line draft" d={curve(draftStart.x, draftStart.y, draft.x, draft.y)} />
      ) : null}
    </svg>
  )
}
