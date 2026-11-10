import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Edges } from './Edges'
import { anchor, CARD_WIDTH, clampCardWidth } from './geometry'
import { HtmlEditor } from './HtmlEditor'
import { NodeCard } from './NodeCard'
import type { BoardSnapshot, DraftLink, Peer, Size } from './types'
import { useBoardSync } from './useBoardSync'
import { Watermark } from './Watermark'

const STAGGER = 24
const TAG_ERROR = 'The card has to be defined with HTML tags.'
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const ZOOM_STEP = 0.25
const GRID = 22

function markupErrorOf(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (doc.querySelector('script')) return TAG_ERROR
  const hasElement = Array.from(doc.body.childNodes).some((node) => node.nodeType === Node.ELEMENT_NODE)
  if (!hasElement) return TAG_ERROR
  return null
}

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
  | { kind: 'resize'; pointerId: number; id: string; startClientX: number; originWidth: number }

export function Board({ initial, name }: { initial: BoardSnapshot; name: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const panRef = useRef<Pan>({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const placeStep = useRef(0)
  const centerToken = useRef(0)
  const followStep = useRef<Record<string, number>>({})
  const sync = useBoardSync(initial, name)
  const syncRef = useRef(sync)
  syncRef.current = sync
  const { nodes, edges, peers, me, status } = sync
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [sizes, setSizes] = useState<Record<string, Size>>({})
  const [draft, setDraft] = useState<DraftLink | null>(null)
  const [panning, setPanning] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [markup, setMarkup] = useState('')
  const [markupError, setMarkupError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(true)
  const [hintOpen, setHintOpen] = useState(true)

  panRef.current = pan
  zoomRef.current = zoom

  const toBoard = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const scale = zoomRef.current || 1
    return {
      x: (clientX - (rect?.left ?? 0) - panRef.current.x) / scale,
      y: (clientY - (rect?.top ?? 0) - panRef.current.y) / scale,
    }
  }, [])

  const toBoardRef = useRef(toBoard)
  toBoardRef.current = toBoard

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const rect = viewportRef.current?.getBoundingClientRect()
      const inside =
        rect !== undefined &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      syncRef.current.noteCursor(inside ? toBoardRef.current(event.clientX, event.clientY) : null)
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
        const scale = zoomRef.current || 1
        syncRef.current.previewMove(
          current.id,
          current.originX + (event.clientX - current.startClientX) / scale,
          current.originY + (event.clientY - current.startClientY) / scale,
        )
        return
      }
      if (current.kind === 'resize') {
        const scale = zoomRef.current || 1
        syncRef.current.previewResize(
          current.id,
          clampCardWidth(current.originWidth + (event.clientX - current.startClientX) / scale),
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
      setResizing(false)
      if (current.kind === 'drag') {
        const scale = zoomRef.current || 1
        syncRef.current.commitMove(
          current.id,
          current.originX + (event.clientX - current.startClientX) / scale,
          current.originY + (event.clientY - current.startClientY) / scale,
        )
        return
      }
      if (current.kind === 'resize') {
        const scale = zoomRef.current || 1
        syncRef.current.commitResize(
          current.id,
          clampCardWidth(current.originWidth + (event.clientX - current.startClientX) / scale),
        )
        return
      }
      if (current.kind !== 'connect') return
      const hit = document.elementFromPoint(event.clientX, event.clientY)
      const toId = hit?.closest('[data-node-id]')?.getAttribute('data-node-id')
      setDraft(null)
      if (!toId || toId === current.fromId) return
      syncRef.current.addEdge({ id: `e-${crypto.randomUUID()}`, from: current.fromId, to: toId })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      centerToken.current += 1
    }
  }, [])

  const onResize = useCallback((id: string, size: Size) => {
    setSizes((prev) => {
      const current = prev[id]
      if (current && current.width === size.width && current.height === size.height) return prev
      return { ...prev, [id]: size }
    })
  }, [])

  function cancelCenter() {
    centerToken.current += 1
  }

  function onBackgroundPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    cancelCenter()
    const target = event.target as Element
    if (target.closest('[data-node-id]') || target.closest('.edge-hit') || target.closest('[data-chrome]')) return
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
    cancelCenter()
    event.stopPropagation()
    event.preventDefault()
    const node = nodes.find((item) => item.id === id)
    if (!node) return
    sync.setDragged(id)
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

  function onResizeStart(id: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    cancelCenter()
    event.stopPropagation()
    event.preventDefault()
    const node = nodes.find((item) => item.id === id)
    if (!node) return
    gesture.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      id,
      startClientX: event.clientX,
      originWidth: node.width ?? CARD_WIDTH,
    }
    setResizing(true)
  }

  function onResizeKey(id: string, event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const node = nodes.find((item) => item.id === id)
    if (!node) return
    const delta = event.key === 'ArrowRight' ? 16 : -16
    sync.commitResize(id, clampCardWidth((node.width ?? CARD_WIDTH) + delta))
  }

  function onConnectStart(id: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    cancelCenter()
    event.stopPropagation()
    event.preventDefault()
    const node = nodes.find((item) => item.id === id)
    if (!node) return
    gesture.current = { kind: 'connect', pointerId: event.pointerId, fromId: id }
    const port = anchor(node, sizes[id], 'right')
    setDraft({ fromId: id, x: port.x, y: port.y })
  }

  function removeEdge(id: string) {
    sync.removeEdge(id)
  }

  function beginEdit(id: string) {
    const node = nodes.find((item) => item.id === id)
    if (!node) return
    setEditingId(id)
    setMarkup(node.html)
    setMarkupError(null)
    setComposerOpen(true)
  }

  function cancelEdit() {
    setEditingId(null)
    setMarkup('')
    setMarkupError(null)
  }

  function addCard() {
    const html = markup.trim()
    if (!html) return
    const error = markupErrorOf(html)
    if (error) {
      setMarkupError(error)
      return
    }
    if (editingId) {
      sync.updateNode(editingId, html)
      setEditingId(null)
      setMarkup('')
      setMarkupError(null)
      return
    }
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const step = placeStep.current * STAGGER
    placeStep.current += 1
    const scale = zoomRef.current || 1
    const x = (rect.width / 2 - panRef.current.x) / scale - CARD_WIDTH / 2 + step
    const y = (rect.height / 2 - panRef.current.y) / scale + step
    sync.addNode({ id: `n-${crypto.randomUUID()}`, x, y, html })
    setMarkup('')
    setMarkupError(null)
  }

  function neighborIds(id: string, direction: 'in' | 'out') {
    const ids: string[] = []
    for (const edge of edges) {
      const next = direction === 'out' ? (edge.from === id ? edge.to : null) : edge.to === id ? edge.from : null
      if (next && !ids.includes(next)) ids.push(next)
    }
    return ids
  }

  function followNode(id: string, direction: 'in' | 'out') {
    const ids = neighborIds(id, direction)
    if (ids.length === 0) return
    const key = `${id}:${direction}`
    const index = followStep.current[key] ?? 0
    const target = ids[index % ids.length]
    followStep.current[key] = (index + 1) % ids.length
    centerNode(target)
  }

  function centerNode(id: string) {
    const node = nodes.find((item) => item.id === id)
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!node || !rect) return
    const element = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
    const measured = element instanceof HTMLElement ? element : null
    const width = sizes[id]?.width || measured?.offsetWidth || CARD_WIDTH
    const height = sizes[id]?.height || measured?.offsetHeight || 0
    const scale = zoomRef.current || 1
    const targetX = rect.width / 2 - (node.x + width / 2) * scale
    const targetY = rect.height / 2 - (node.y + height / 2) * scale
    const from = panRef.current
    const token = ++centerToken.current
    const started = performance.now()
    const duration = 280
    const step = (now: number) => {
      if (centerToken.current !== token) return
      const t = Math.min(1, (now - started) / duration)
      const eased = 1 - (1 - t) ** 3
      setPan({
        x: from.x + (targetX - from.x) * eased,
        y: from.y + (targetY - from.y) * eased,
      })
      if (t < 1) requestAnimationFrame(step)
    }
    const active = gesture.current
    if (active?.kind === 'drag') {
      const dragged = nodes.find((item) => item.id === active.id)
      if (dragged) sync.commitMove(dragged.id, dragged.x, dragged.y)
    }
    if (active?.kind === 'resize') {
      const resized = nodes.find((item) => item.id === active.id)
      sync.commitResize(active.id, resized?.width ?? active.originWidth)
    }
    gesture.current = null
    setPanning(false)
    setResizing(false)
    requestAnimationFrame(step)
  }

  function zoomBy(direction: 1 | -1) {
    const rect = viewportRef.current?.getBoundingClientRect()
    const current = zoomRef.current
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((current + direction * ZOOM_STEP) * 100) / 100))
    if (!rect || next === current) return
    cancelCenter()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const boardX = (cx - panRef.current.x) / current
    const boardY = (cy - panRef.current.y) / current
    const origin = { x: cx - boardX * next, y: cy - boardY * next }
    panRef.current = origin
    zoomRef.current = next
    setPan(origin)
    setZoom(next)
  }

  function removeNode(id: string) {
    if (editingId === id) cancelEdit()
    sync.removeNode(id)
    setSizes((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  useEffect(() => {
    setSizes((prev) => {
      const ids = new Set(nodes.map((node) => node.id))
      let changed = false
      const next: Record<string, Size> = {}
      for (const [id, size] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = size
        else changed = true
      }
      return changed ? next : prev
    })
  }, [nodes])

  useEffect(() => {
    if (editingId && !nodes.some((node) => node.id === editingId)) cancelEdit()
  }, [nodes, editingId])

  const people: Peer[] = peers.some((peer) => peer.clientId === me.clientId)
    ? peers
    : [{ clientId: me.clientId, name: me.name, color: me.color, cursor: null }, ...peers]
  const statusLabel = status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Reconnecting'
  const className = panning
    ? 'viewport is-panning'
    : resizing
      ? 'viewport is-resizing'
      : draft
        ? 'viewport is-connecting'
        : 'viewport'

  return (
    <div className="app-shell">
      <aside className={composerOpen ? 'composer' : 'composer is-collapsed'} data-chrome>
        <div className="composer-head">
          <span className="composer-title">HTML</span>
          <button
            type="button"
            className="composer-toggle"
            aria-expanded={composerOpen}
            aria-controls={composerOpen ? 'card-html' : undefined}
            aria-label={composerOpen ? 'Collapse HTML panel' : 'Expand HTML panel'}
            onClick={() => setComposerOpen((open) => !open)}
          >
            <span aria-hidden="true">{composerOpen ? '‹' : '›'}</span>
          </button>
        </div>
        {composerOpen ? (
          <div className="composer-body">
            <label className="composer-label" id="card-html-label" htmlFor="card-html">
              {editingId ? 'Edit markup' : 'Card markup'}
            </label>
            <HtmlEditor
              value={markup}
              onChange={(next) => {
                setMarkup(next)
                setMarkupError(null)
              }}
            />
            <div className="composer-preview">
              {markup.trim() ? (
                <div className="node-body" dangerouslySetInnerHTML={{ __html: markup }} />
              ) : (
                <p className="composer-empty">Preview shows the card as you write tags.</p>
              )}
            </div>
            {markupError ? (
              <p className="composer-error" role="alert">
                {markupError}
              </p>
            ) : null}
            <div className="composer-actions">
              {editingId ? (
                <button type="button" className="composer-cancel" onClick={cancelEdit}>
                  Cancel
                </button>
              ) : null}
              <button type="button" className="composer-add" onClick={addCard}>
                {editingId ? 'Save card' : 'Add card'}
              </button>
            </div>
          </div>
        ) : null}
      </aside>
      <div
        ref={viewportRef}
        className={className}
        style={{
          backgroundPosition: `${pan.x}px ${pan.y}px`,
          backgroundSize: `${GRID * zoom}px ${GRID * zoom}px`,
        }}
        onPointerDown={onBackgroundPointerDown}
        onPointerLeave={() => sync.noteCursor(null)}
      >
        <div className="world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <Edges nodes={nodes} edges={edges} sizes={sizes} draft={draft} onRemove={removeEdge} />
          {nodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              onResize={onResize}
              onResizeStart={onResizeStart}
              onResizeKey={onResizeKey}
              onDragStart={onDragStart}
              onConnectStart={onConnectStart}
              onCenter={centerNode}
              onFollow={followNode}
              canFollowIn={edges.some((edge) => edge.to === node.id)}
              canFollowOut={edges.some((edge) => edge.from === node.id)}
              editing={editingId === node.id}
              onEdit={beginEdit}
              onRemove={removeNode}
            />
          ))}
          {peers.map((peer) =>
            peer.clientId === me.clientId || !peer.cursor ? null : (
              <div
                key={peer.clientId}
                className="remote-cursor"
                style={{ transform: `translate(${peer.cursor.x}px, ${peer.cursor.y}px)` }}
                aria-hidden="true"
              >
                <span className="remote-cursor-mark" style={{ background: peer.color }} />
                <span className="remote-cursor-name" style={{ background: peer.color }}>
                  {peer.name}
                </span>
              </div>
            ),
          )}
        </div>
        <div className="zoom-controls" data-chrome>
          <button type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy(1)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => zoomBy(-1)}>
            −
          </button>
        </div>
        <div className="roster" data-chrome>
          <p className="roster-status">
            <span className={`roster-dot ${status}`} />
            {statusLabel}
          </p>
          <ul aria-label="People on this board">
            {people.map((peer) => (
              <li key={peer.clientId}>
                <span className="roster-swatch" style={{ background: peer.color }} />
                {peer.clientId === me.clientId ? `${peer.name} (you)` : peer.name}
              </li>
            ))}
          </ul>
        </div>
        <Watermark />
        {hintOpen ? (
          <div className="hint" data-chrome>
            <p>
              Write HTML in the panel to add a card. Use the card control to remove one, the center control to bring
              it into view, and the arrows to follow a connected card. Drag a handle to move, the right edge to resize,
              a port to connect, a line to remove it, and empty space to pan. Use the pencil to edit a card in the side
              panel, and + and − to zoom. Moves, resizes, and edits are shared. Panning and zoom stay on this screen.
            </p>
            <button type="button" className="hint-dismiss" aria-label="Dismiss note" onClick={() => setHintOpen(false)}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
