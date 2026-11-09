import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Edges } from './Edges'
import { anchor } from './geometry'
import { NodeCard } from './NodeCard'
import type { Board as BoardData, BoardEdge, BoardNode, DraftLink, Size } from './types'

type Pan = { x: number; y: number }

type Gesture =
  | { kind: 'pan'; pointerId: number; startClientX: number; startClientY: number; origin: Pan }
  | {
      kind: 'drag'
      pointerId: number
      id: string
      startClientX: number
      startClientY: number
      originX: number
      originY: number
    }
  | { kind: 'connect'; pointerId: number; fromId: string }

export function Board({ initial }: { initial: BoardData }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const panRef = useRef<Pan>({ x: 0, y: 0 })
  const [nodes, setNodes] = useState<BoardNode[]>(initial.nodes)
  const [edges, setEdges] = useState<BoardEdge[]>(initial.edges)
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 })
  const [sizes, setSizes] = useState<Record<string, Size>>({})
  const [draft, setDraft] = useState<DraftLink | null>(null)
  const [panning, setPanning] = useState(false)

  panRef.current = pan

  const toBoard = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    return {
      x: clientX - (rect?.left ?? 0) - panRef.current.x,
      y: clientY - (rect?.top ?? 0) - panRef.current.y,
    }
  }, [])

  const toBoardRef = useRef(toBoard)
  toBoardRef.current = toBoard

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current
      if (!current || event.pointerId !== current.pointerId) return
      if (current.kind === 'pan') {
        setPan({
          x: current.origin.x + event.clientX - current.startClientX,
          y: current.origin.y + event.clientY - current.startClientY,
        })
        return
      }
      if (current.kind === 'drag') {
        const dx = event.clientX - current.startClientX
        const dy = event.clientY - current.startClientY
        setNodes((prev) =>
          prev.map((node) =>
            node.id === current.id ? { ...node, x: current.originX + dx, y: current.originY + dy } : node,
          ),
        )
        return
      }
      const point = toBoardRef.current(event.clientX, event.clientY)
      setDraft({ fromId: current.fromId, x: point.x, y: point.y })
    }

    const up = (event: PointerEvent) => {
      const current = gesture.current
      if (!current || event.pointerId !== current.pointerId) return
      gesture.current = null
      setPanning(false)
      if (current.kind !== 'connect') return
      const hit = document.elementFromPoint(event.clientX, event.clientY)
      const toId = hit?.closest('[data-node-id]')?.getAttribute('data-node-id')
      setDraft(null)
      if (!toId || toId === current.fromId) return
      setEdges((prev) => {
        if (prev.some((edge) => edge.from === current.fromId && edge.to === toId)) return prev
        return [...prev, { id: `e-${crypto.randomUUID()}`, from: current.fromId, to: toId }]
      })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  const onResize = useCallback((id: string, size: Size) => {
    setSizes((prev) => {
      const current = prev[id]
      if (current && current.width === size.width && current.height === size.height) return prev
      return { ...prev, [id]: size }
    })
  }, [])

  function onBackgroundPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const target = event.target as Element
    if (target.closest('[data-node-id]') || target.closest('.edge-hit')) return
    gesture.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin: { ...panRef.current },
    }
    setPanning(true)
  }

  function onDragStart(id: string, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const node = nodes.find((item) => item.id === id)
    if (!node) return
    gesture.current = {
      kind: 'drag',
      pointerId: event.pointerId,
      id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: node.x,
      originY: node.y,
    }
  }

  function onConnectStart(id: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const node = nodes.find((item) => item.id === id)
    if (!node) return
    gesture.current = { kind: 'connect', pointerId: event.pointerId, fromId: id }
    const port = anchor(node, sizes[id], 'right')
    setDraft({ fromId: id, x: port.x, y: port.y })
  }

  function removeEdge(id: string) {
    setEdges((prev) => prev.filter((edge) => edge.id !== id))
  }

  const className = panning ? 'viewport is-panning' : draft ? 'viewport is-connecting' : 'viewport'

  return (
    <div
      ref={viewportRef}
      className={className}
      style={{ backgroundPosition: `${pan.x}px ${pan.y}px` }}
      onPointerDown={onBackgroundPointerDown}
    >
      <div className="world" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        <Edges nodes={nodes} edges={edges} sizes={sizes} draft={draft} onRemove={removeEdge} />
        {nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            onResize={onResize}
            onDragStart={onDragStart}
            onConnectStart={onConnectStart}
          />
        ))}
      </div>
      <p className="hint">
        Drag a handle to move. Drag a port onto another node to connect. Click a line to remove it.
        Drag empty space to pan. Changes stay in this tab.
      </p>
    </div>
  )
}
