import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  cardMetrics,
  drawBoard,
  hitTest,
  nodeAtPoint,
  type CardMetrics,
  type Hit,
  type Pan,
} from './boardDraw'
import { CARD_WIDTH, clampCardWidth } from './geometry'
import { CardBitmapCache, type CardBitmap } from './htmlBitmap'
import { asHtmlInCanvas, supportsHtmlInCanvas, type HtmlInCanvasElement } from './htmlInCanvas'
import { HtmlEditor } from './HtmlEditor'
import type { BoardSnapshot, DraftLink, Peer, Size } from './types'
import { useBoardSync } from './useBoardSync'
import { Watermark } from './Watermark'

const HTML_IN_CANVAS = supportsHtmlInCanvas()

const STAGGER = 24
const TAG_ERROR = 'The card has to be defined with HTML tags.'
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const ZOOM_STEP = 0.25

function markupErrorOf(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (doc.querySelector('script')) return TAG_ERROR
  const hasElement = Array.from(doc.body.childNodes).some((node) => node.nodeType === Node.ELEMENT_NODE)
  if (!hasElement) return TAG_ERROR
  return null
}

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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const panRef = useRef<Pan>({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const placeStep = useRef(0)
  const centerToken = useRef(0)
  const followStep = useRef<Record<string, number>>({})
  const sizesRef = useRef<Record<string, Size>>({})
  const metricsRef = useRef<Record<string, CardMetrics>>({})
  const bitmapsRef = useRef<Record<string, CardBitmap | undefined>>({})
  const draftRef = useRef<DraftLink | null>(null)
  const editingRef = useRef<string | null>(null)
  const bitmapCache = useRef(new CardBitmapCache())
  const cardElementsRef = useRef<Record<string, HTMLElement | undefined>>({})
  const sync = useBoardSync(initial, name)
  const syncRef = useRef(sync)
  syncRef.current = sync
  const { nodes, edges, peers, me, status } = sync
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const peersRef = useRef(peers)
  nodesRef.current = nodes
  edgesRef.current = edges
  peersRef.current = peers

  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [sizes, setSizes] = useState<Record<string, Size>>({})
  const [metrics, setMetrics] = useState<Record<string, CardMetrics>>({})
  const [bitmaps, setBitmaps] = useState<Record<string, CardBitmap | undefined>>({})
  const [draft, setDraft] = useState<DraftLink | null>(null)
  const [panning, setPanning] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [markup, setMarkup] = useState('')
  const [markupError, setMarkupError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(true)
  const [hintOpen, setHintOpen] = useState(true)
  const [cursor, setCursor] = useState('grab')

  panRef.current = pan
  zoomRef.current = zoom
  sizesRef.current = sizes
  metricsRef.current = metrics
  bitmapsRef.current = bitmaps
  draftRef.current = draft
  editingRef.current = editingId

  const setCardElement = (id: string, element: HTMLElement | null) => {
    if (!element) {
      delete cardElementsRef.current[id]
      return
    }
    cardElementsRef.current[id] = element
  }

  const syncDrawableMetrics = () => {
    if (!HTML_IN_CANVAS) return
    const nextSizes: Record<string, Size> = { ...sizesRef.current }
    const nextMetrics: Record<string, CardMetrics> = { ...metricsRef.current }
    const liveIds = new Set(nodesRef.current.map((node) => node.id))
    let changed = false

    for (const id of Object.keys(nextSizes)) {
      if (!liveIds.has(id)) {
        delete nextSizes[id]
        delete nextMetrics[id]
        changed = true
      }
    }

    for (const node of nodesRef.current) {
      const width = clampCardWidth(node.width ?? CARD_WIDTH)
      const element = cardElementsRef.current[node.id]
      const bodyHeight = Math.max(
        40,
        element?.offsetHeight || bitmapCache.current.measureBodyHeight(node.html, width),
      )
      const metric = cardMetrics(node, undefined, bodyHeight)
      const prev = nextMetrics[node.id]
      if (!prev || prev.width !== metric.width || prev.height !== metric.height) {
        changed = true
      }
      nextMetrics[node.id] = metric
      nextSizes[node.id] = { width: metric.width, height: metric.height }
    }

    if (!changed) return
    sizesRef.current = nextSizes
    metricsRef.current = nextMetrics
    setSizes(nextSizes)
    setMetrics(nextMetrics)
  }

  const toBoard = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const scale = zoomRef.current || 1
    return {
      x: (clientX - (rect?.left ?? 0) - panRef.current.x) / scale,
      y: (clientY - (rect?.top ?? 0) - panRef.current.y) / scale,
    }
  }

  const followsFor = () => {
    const map: Record<string, { in: boolean; out: boolean }> = {}
    for (const node of nodesRef.current) map[node.id] = { in: false, out: false }
    for (const edge of edgesRef.current) {
      if (map[edge.from]) map[edge.from].out = true
      if (map[edge.to]) map[edge.to].in = true
    }
    return map
  }

  const ensureCanvasSize = () => {
    const canvas = canvasRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport) return null
    const rect = viewport.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    return { canvas, width, height, dpr }
  }

  const paint = () => {
    const sized = ensureCanvasSize()
    if (!sized) return
    syncDrawableMetrics()
    const ctx = sized.canvas.getContext('2d')
    if (!ctx) return
    drawBoard({
      ctx,
      width: sized.width,
      height: sized.height,
      dpr: sized.dpr,
      pan: panRef.current,
      zoom: zoomRef.current,
      nodes: nodesRef.current,
      edges: edgesRef.current,
      sizes: sizesRef.current,
      metrics: metricsRef.current,
      bitmaps: bitmapsRef.current,
      elements: HTML_IN_CANVAS ? cardElementsRef.current : undefined,
      draft: draftRef.current,
      peers: peersRef.current,
      meId: syncRef.current.me.clientId,
      editingId: editingRef.current,
      follows: followsFor(),
    })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (HTML_IN_CANVAS) {
      canvas.setAttribute('content', 'drawable')
      const hic = asHtmlInCanvas(canvas) as HtmlInCanvasElement
      const onPaint = (_event: Event) => {
        paint()
      }
      canvas.addEventListener('paint', onPaint as EventListener)
      let frame = 0
      const tick = () => {
        ensureCanvasSize()
        hic.requestPaint()
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
      const onResize = () => hic.requestPaint()
      window.addEventListener('resize', onResize)
      return () => {
        cancelAnimationFrame(frame)
        canvas.removeEventListener('paint', onPaint as EventListener)
        window.removeEventListener('resize', onResize)
      }
    }

    let frame = 0
    const tick = () => {
      paint()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const onResize = () => paint()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    if (HTML_IN_CANVAS) {
      syncDrawableMetrics()
      asHtmlInCanvas(canvasRef.current)?.requestPaint()
      return
    }

    let cancelled = false
    const cache = bitmapCache.current
    const liveIds = new Set(nodes.map((node) => node.id))
    cache.prune(liveIds)

    const nextSizes: Record<string, Size> = { ...sizesRef.current }
    const nextMetrics: Record<string, CardMetrics> = { ...metricsRef.current }
    const nextBitmaps: Record<string, CardBitmap | undefined> = { ...bitmapsRef.current }
    let changed = false

    for (const id of Object.keys(nextSizes)) {
      if (!liveIds.has(id)) {
        delete nextSizes[id]
        delete nextMetrics[id]
        delete nextBitmaps[id]
        changed = true
      }
    }

    const tasks = nodes.map(async (node) => {
      const width = clampCardWidth(node.width ?? CARD_WIDTH)
      const bodyHeight = cache.measureBodyHeight(node.html, width)
      const metric = cardMetrics(node, undefined, bodyHeight)
      const prev = nextMetrics[node.id]
      if (!prev || prev.width !== metric.width || prev.height !== metric.height) {
        nextMetrics[node.id] = metric
        nextSizes[node.id] = { width: metric.width, height: metric.height }
        changed = true
      }
      const key = cache.key(node.id, node.html, width)
      const cached = cache.peek(key)
      if (cached && nextBitmaps[node.id] === cached) return
      const bitmap = cached ?? (await cache.ensure(node.id, node.html, width))
      if (cancelled) return
      nextBitmaps[node.id] = bitmap
      nextMetrics[node.id] = cardMetrics(node, undefined, bitmap.bodyHeight)
      nextSizes[node.id] = {
        width: nextMetrics[node.id].width,
        height: nextMetrics[node.id].height,
      }
      changed = true
    })

    void Promise.all(tasks).then(() => {
      if (cancelled || !changed) return
      setSizes(nextSizes)
      setMetrics(nextMetrics)
      setBitmaps(nextBitmaps)
    })

    if (changed) {
      setSizes(nextSizes)
      setMetrics(nextMetrics)
    }

    return () => {
      cancelled = true
    }
  }, [nodes])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const rect = viewportRef.current?.getBoundingClientRect()
      const inside =
        rect !== undefined &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      const point = inside ? toBoard(event.clientX, event.clientY) : null
      syncRef.current.noteCursor(point)

      const current = gesture.current
      if (!current || event.pointerId !== current.pointerId) {
        if (!inside || !point) {
          setCursor('grab')
          return
        }
        const hit = hitTest({
          boardX: point.x,
          boardY: point.y,
          zoom: zoomRef.current,
          nodes: nodesRef.current,
          edges: edgesRef.current,
          sizes: sizesRef.current,
          metrics: metricsRef.current,
          follows: followsFor(),
        })
        setCursor(cursorFor(hit))
        return
      }
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
      if (!point) return
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
      const point = toBoard(event.clientX, event.clientY)
      const toId = nodeAtPoint(point.x, point.y, nodesRef.current, metricsRef.current, sizesRef.current)
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

  function cancelCenter() {
    centerToken.current += 1
  }

  function onCanvasPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return
    cancelCenter()
    const point = toBoard(event.clientX, event.clientY)
    const hit = hitTest({
      boardX: point.x,
      boardY: point.y,
      zoom: zoomRef.current,
      nodes: nodesRef.current,
      edges: edgesRef.current,
      sizes: sizesRef.current,
      metrics: metricsRef.current,
      follows: followsFor(),
    })

    if (hit.kind === 'edge') {
      sync.removeEdge(hit.id)
      return
    }
    if (hit.kind === 'remove') {
      removeNode(hit.id)
      return
    }
    if (hit.kind === 'edit') {
      beginEdit(hit.id)
      return
    }
    if (hit.kind === 'center') {
      centerNode(hit.id)
      return
    }
    if (hit.kind === 'follow') {
      followNode(hit.id, hit.direction)
      return
    }
    if (hit.kind === 'port') {
      const node = nodes.find((item) => item.id === hit.id)
      if (!node) return
      gesture.current = { kind: 'connect', pointerId: event.pointerId, fromId: hit.id }
      const metric = metrics[hit.id] ?? cardMetrics(node, sizes[hit.id])
      setDraft({ fromId: hit.id, x: node.x + metric.width, y: node.y + metric.height / 2 })
      setCursor('crosshair')
      return
    }
    if (hit.kind === 'resize') {
      const node = nodes.find((item) => item.id === hit.id)
      if (!node) return
      gesture.current = {
        kind: 'resize',
        pointerId: event.pointerId,
        id: hit.id,
        startClientX: event.clientX,
        originWidth: node.width ?? CARD_WIDTH,
      }
      setResizing(true)
      setCursor('ew-resize')
      return
    }
    if (hit.kind === 'handle' || hit.kind === 'card') {
      const node = nodes.find((item) => item.id === hit.id)
      if (!node) return
      sync.setDragged(hit.id)
      gesture.current = {
        kind: 'drag',
        pointerId: event.pointerId,
        id: hit.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        originX: node.x,
        originY: node.y,
      }
      setCursor('grabbing')
      return
    }

    gesture.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin: { ...panRef.current },
    }
    setPanning(true)
    setCursor('grabbing')
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
    const metric = metrics[id] ?? cardMetrics(node, sizes[id])
    const scale = zoomRef.current || 1
    const targetX = rect.width / 2 - (node.x + metric.width / 2) * scale
    const targetY = rect.height / 2 - (node.y + metric.height / 2) * scale
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
  }

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
      <div ref={viewportRef} className={className} onPointerLeave={() => sync.noteCursor(null)}>
        <canvas
          ref={canvasRef}
          className="board-canvas"
          style={{ cursor }}
          onPointerDown={onCanvasPointerDown}
          aria-label="Board canvas"
          {...(HTML_IN_CANVAS ? { content: 'drawable' } : {})}
        >
          {HTML_IN_CANVAS
            ? nodes.map((node) => (
                <div
                  key={node.id}
                  // HTML-in-Canvas paint root for this card body.
                  {...{ drawable: '' }}
                  className="node-body card-drawable"
                  data-card-id={node.id}
                  style={{ width: clampCardWidth(node.width ?? CARD_WIDTH) }}
                  ref={(element) => setCardElement(node.id, element)}
                  dangerouslySetInnerHTML={{ __html: node.html }}
                />
              ))
            : null}
        </canvas>
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
              {HTML_IN_CANVAS
                ? 'Card HTML is live DOM drawn with the HTML-in-Canvas API (drawElementImage).'
                : 'Card HTML is rasterized onto the canvas when HTML-in-Canvas is unavailable.'}{' '}
              Write HTML in the panel to add a card. Drag a card to move it, the right edge to resize, a port to
              connect, a line to remove it, and empty space to pan. Use the pencil to edit, and + and − to zoom. Moves,
              resizes, and edits are shared.
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

function cursorFor(hit: Hit): string {
  if (hit.kind === 'port') return 'crosshair'
  if (hit.kind === 'resize') return 'ew-resize'
  if (hit.kind === 'handle' || hit.kind === 'card') return 'grab'
  if (hit.kind === 'edge') return 'pointer'
  if (
    hit.kind === 'edit' ||
    hit.kind === 'remove' ||
    hit.kind === 'center' ||
    hit.kind === 'follow'
  ) {
    return 'pointer'
  }
  return 'grab'
}
