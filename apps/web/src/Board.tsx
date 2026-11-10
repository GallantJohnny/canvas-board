import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Edges } from './Edges'
import { anchor } from './geometry'
import { HtmlEditor } from './HtmlEditor'
import { NodeCard } from './NodeCard'
import type { BoardSnapshot, DraftLink, Peer, Size } from './types'
import { useBoardSync } from './useBoardSync'

const CARD_WIDTH = 280
const STAGGER = 24
const TAG_ERROR = 'The card has to be defined with HTML tags.'

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

export function Board({ initial, name }: { initial: BoardSnapshot; name: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const panRef = useRef<Pan>({ x: 0, y: 0 })
  const placeStep = useRef(0)
  const centerToken = useRef(0)
  const followStep = useRef<Record<string, number>>({})
  const sync = useBoardSync(initial, name)
  const syncRef = useRef(sync)
  syncRef.current = sync
  const { nodes, edges, peers, me, status } = sync
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 })
  const [sizes, setSizes] = useState<Record<string, Size>>({})
  const [draft, setDraft] = useState<DraftLink | null>(null)
  const [panning, setPanning] = useState(false)
  const [markup, setMarkup] = useState('')
  const [markupError, setMarkupError] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(true)
  const [hintOpen, setHintOpen] = useState(true)

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
        syncRef.current.previewMove(
          current.id,
          current.originX + event.clientX - current.startClientX,
          current.originY + event.clientY - current.startClientY,
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
      if (current.kind === 'drag') {
        syncRef.current.commitMove(
          current.id,
          current.originX + event.clientX - current.startClientX,
          current.originY + event.clientY - current.startClientY,
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

  function addCard() {
    const html = markup.trim()
    if (!html) return
    const error = markupErrorOf(html)
    if (error) {
      setMarkupError(error)
      return
    }
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const step = placeStep.current * STAGGER
    placeStep.current += 1
    const x = rect.width / 2 - panRef.current.x - CARD_WIDTH / 2 + step
    const y = rect.height / 2 - panRef.current.y + step
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
    const targetX = rect.width / 2 - (node.x + width / 2)
    const targetY = rect.height / 2 - (node.y + height / 2)
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
    gesture.current = null
    setPanning(false)
    requestAnimationFrame(step)
  }

  function removeNode(id: string) {
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

  const people: Peer[] = peers.some((peer) => peer.clientId === me.clientId)
    ? peers
    : [{ clientId: me.clientId, name: me.name, color: me.color, cursor: null }, ...peers]
  const statusLabel = status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Reconnecting'
  const className = panning ? 'viewport is-panning' : draft ? 'viewport is-connecting' : 'viewport'

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
              Card markup
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
            <button type="button" className="composer-add" onClick={addCard}>
              Add card
            </button>
          </div>
        ) : null}
      </aside>
      <div
        ref={viewportRef}
        className={className}
        style={{ backgroundPosition: `${pan.x}px ${pan.y}px` }}
        onPointerDown={onBackgroundPointerDown}
        onPointerLeave={() => sync.noteCursor(null)}
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
              onCenter={centerNode}
              onFollow={followNode}
              canFollowIn={edges.some((edge) => edge.to === node.id)}
              canFollowOut={edges.some((edge) => edge.from === node.id)}
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
        {hintOpen ? (
          <div className="hint" data-chrome>
            <p>
              Write HTML in the panel to add a card. Use the card control to remove one, the center control to bring
              it into view, and the arrows to follow a connected card. Drag a handle to move, a port to connect, a
              line to remove it, and empty space to pan. Moves and edits are shared. Panning stays on this screen.
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
