import { CARD_WIDTH, anchor, clampCardWidth, curvePoints } from './geometry'
import type { CardBitmap } from './htmlBitmap'
import type { BoardEdge, BoardNode, DraftLink, Peer, Size } from './types'

export const BAR_HEIGHT = 28
export const BTN = 28
export const PORT_R = 7
export const INLET_R = 5
export const RADIUS = 12
export const GRID = 22

export type Pan = { x: number; y: number }

export type Hit =
  | { kind: 'chrome' }
  | { kind: 'edge'; id: string }
  | { kind: 'port'; id: string }
  | { kind: 'resize'; id: string }
  | { kind: 'handle'; id: string }
  | { kind: 'follow'; id: string; direction: 'in' | 'out' }
  | { kind: 'center'; id: string }
  | { kind: 'edit'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'card'; id: string }
  | { kind: 'board' }

export type CardMetrics = {
  width: number
  height: number
  bodyHeight: number
}

export function cardMetrics(node: BoardNode, size: Size | undefined, bodyHeight?: number): CardMetrics {
  const width = clampCardWidth(node.width ?? size?.width ?? CARD_WIDTH)
  const measuredBody = bodyHeight ?? Math.max(40, (size?.height ?? BAR_HEIGHT + 140) - BAR_HEIGHT)
  return {
    width,
    bodyHeight: measuredBody,
    height: BAR_HEIGHT + measuredBody,
  }
}

type ButtonSlot = {
  kind: 'follow-in' | 'follow-out' | 'center' | 'edit' | 'remove'
  x: number
  y: number
  w: number
  h: number
}

function buttonSlots(
  node: BoardNode,
  metrics: CardMetrics,
  canFollowIn: boolean,
  canFollowOut: boolean,
): ButtonSlot[] {
  const slots: ButtonSlot[] = []
  let right = node.x + metrics.width
  const push = (kind: ButtonSlot['kind']) => {
    right -= BTN
    slots.push({ kind, x: right, y: node.y, w: BTN, h: BAR_HEIGHT })
  }
  push('remove')
  push('edit')
  push('center')
  if (canFollowOut) push('follow-out')
  if (canFollowIn) push('follow-in')
  return slots
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function strokeCurve(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const { c1x, c1y, c2x, c2y } = curvePoints(x1, y1, x2, y2)
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2)
}

function distToCubic(
  px: number,
  py: number,
  x1: number,
  y1: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x2: number,
  y2: number,
) {
  let best = Infinity
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24
    const u = 1 - t
    const x = u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2
    const y = u * u * u * y1 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y2
    const d = (x - px) * (x - px) + (y - py) * (y - py)
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  kind: ButtonSlot['kind'],
  cx: number,
  cy: number,
) {
  ctx.save()
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 1.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (kind === 'follow-in') {
    ctx.beginPath()
    ctx.moveTo(cx + 4, cy)
    ctx.lineTo(cx - 4, cy)
    ctx.moveTo(cx - 1, cy - 4)
    ctx.lineTo(cx - 4, cy)
    ctx.lineTo(cx - 1, cy + 4)
    ctx.stroke()
  } else if (kind === 'follow-out') {
    ctx.beginPath()
    ctx.moveTo(cx - 4, cy)
    ctx.lineTo(cx + 4, cy)
    ctx.moveTo(cx + 1, cy - 4)
    ctx.lineTo(cx + 4, cy)
    ctx.lineTo(cx + 1, cy + 4)
    ctx.stroke()
  } else if (kind === 'center') {
    ctx.beginPath()
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx, cy - 6.4)
    ctx.lineTo(cx, cy - 4.2)
    ctx.moveTo(cx, cy + 4.2)
    ctx.lineTo(cx, cy + 6.4)
    ctx.moveTo(cx - 6.4, cy)
    ctx.lineTo(cx - 4.2, cy)
    ctx.moveTo(cx + 4.2, cy)
    ctx.lineTo(cx + 6.4, cy)
    ctx.stroke()
  } else if (kind === 'edit') {
    ctx.beginPath()
    ctx.moveTo(cx - 4.2, cy + 4.2)
    ctx.lineTo(cx - 4.2, cy + 1.2)
    ctx.lineTo(cx + 3.2, cy - 6.2)
    ctx.lineTo(cx + 6.2, cy - 3.2)
    ctx.lineTo(cx - 1.2, cy + 4.2)
    ctx.closePath()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx + 1.2, cy - 4.2)
    ctx.lineTo(cx + 4.2, cy - 1.2)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.moveTo(cx - 4, cy - 4)
    ctx.lineTo(cx + 4, cy + 4)
    ctx.moveTo(cx + 4, cy - 4)
    ctx.lineTo(cx - 4, cy + 4)
    ctx.stroke()
  }
  ctx.restore()
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  node: BoardNode,
  metrics: CardMetrics,
  bitmap: CardBitmap | undefined,
  editing: boolean,
  canFollowIn: boolean,
  canFollowOut: boolean,
) {
  const { x, y } = node
  const { width, height, bodyHeight } = metrics

  ctx.save()
  ctx.shadowColor = 'rgba(0, 83, 159, 0.08)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 8
  roundRect(ctx, x, y, width, height, RADIUS)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundRect(ctx, x, y, width, height, RADIUS)
  ctx.strokeStyle = '#d5e0ea'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x + RADIUS, y)
  ctx.arcTo(x + width, y, x + width, y + BAR_HEIGHT, RADIUS)
  ctx.lineTo(x + width, y + BAR_HEIGHT)
  ctx.lineTo(x, y + BAR_HEIGHT)
  ctx.arcTo(x, y, x + RADIUS, y, RADIUS)
  ctx.closePath()
  ctx.fillStyle = '#00539f'
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      ctx.beginPath()
      ctx.arc(x + 12 + col * 6, y + 11 + row * 4, 1.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const slots = buttonSlots(node, metrics, canFollowIn, canFollowOut)
  for (const slot of slots) {
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.beginPath()
    ctx.moveTo(slot.x, y + 4)
    ctx.lineTo(slot.x, y + BAR_HEIGHT - 4)
    ctx.stroke()
    if (slot.kind === 'edit' && editing) {
      ctx.fillStyle = 'rgba(255,255,255,0.24)'
      ctx.fillRect(slot.x, slot.y, slot.w, slot.h)
    }
    drawIcon(ctx, slot.kind, slot.x + slot.w / 2, slot.y + slot.h / 2)
  }

  if (bitmap) {
    ctx.drawImage(bitmap.canvas, x, y + BAR_HEIGHT, width, bodyHeight)
  } else {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x, y + BAR_HEIGHT, width, bodyHeight)
  }

  if (editing) {
    ctx.save()
    roundRect(ctx, x - 3, y - 3, width + 6, height + 6, RADIUS + 2)
    ctx.strokeStyle = '#00539f'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
  }

  ctx.fillStyle = '#00539f'
  ctx.beginPath()
  ctx.arc(x, y + height / 2, INLET_R, 0, Math.PI * 2)
  ctx.fill()

  ctx.beginPath()
  ctx.arc(x + width, y + height / 2, PORT_R, 0, Math.PI * 2)
  ctx.fillStyle = '#00539f'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  ctx.strokeStyle = '#d5e0ea'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x + width - 10, y + height / 2 - 7)
  ctx.lineTo(x + width - 10, y + height / 2 + 7)
  ctx.moveTo(x + width - 6, y + height / 2 - 7)
  ctx.lineTo(x + width - 6, y + height / 2 + 7)
  ctx.stroke()
}

function drawCursor(ctx: CanvasRenderingContext2D, peer: Peer) {
  if (!peer.cursor) return
  const { x, y } = peer.cursor
  ctx.save()
  ctx.fillStyle = peer.color
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.font = '11px "Segoe UI", system-ui, sans-serif'
  const label = peer.name
  const width = ctx.measureText(label).width + 12
  const height = 18
  const lx = x + 10
  const ly = y - 8
  roundRect(ctx, lx, ly, width, height, 999)
  ctx.fillStyle = peer.color
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, lx + 6, ly + 13)
  ctx.restore()
}

export function drawBoard(options: {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  pan: Pan
  zoom: number
  nodes: BoardNode[]
  edges: BoardEdge[]
  sizes: Record<string, Size>
  metrics: Record<string, CardMetrics>
  bitmaps: Record<string, CardBitmap | undefined>
  draft: DraftLink | null
  peers: Peer[]
  meId: string
  editingId: string | null
  follows: Record<string, { in: boolean; out: boolean }>
}) {
  const {
    ctx,
    width,
    height,
    pan,
    zoom,
    nodes,
    edges,
    sizes,
    metrics,
    bitmaps,
    draft,
    peers,
    meId,
    editingId,
    follows,
  } = options

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#f4f7fb'
  ctx.fillRect(0, 0, width, height)

  const step = GRID * zoom
  const originX = ((pan.x % step) + step) % step
  const originY = ((pan.y % step) + step) % step
  ctx.fillStyle = 'rgba(0, 83, 159, 0.22)'
  for (let x = originX; x < width; x += step) {
    for (let y = originY; y < height; y += step) {
      ctx.beginPath()
      ctx.arc(x, y, 1, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y)

  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const start = anchor(from, { width: metrics[from.id]?.width ?? sizes[from.id]?.width ?? CARD_WIDTH, height: metrics[from.id]?.height ?? 140 }, 'right')
    const end = anchor(to, { width: metrics[to.id]?.width ?? sizes[to.id]?.width ?? CARD_WIDTH, height: metrics[to.id]?.height ?? 140 }, 'left')
    strokeCurve(ctx, start.x, start.y, end.x, end.y)
    ctx.strokeStyle = '#00539f'
    ctx.lineWidth = 2 / zoom
    ctx.stroke()
  }

  if (draft) {
    const from = byId.get(draft.fromId)
    if (from) {
      const start = anchor(
        from,
        {
          width: metrics[from.id]?.width ?? sizes[from.id]?.width ?? CARD_WIDTH,
          height: metrics[from.id]?.height ?? 140,
        },
        'right',
      )
      strokeCurve(ctx, start.x, start.y, draft.x, draft.y)
      ctx.strokeStyle = '#00539f'
      ctx.lineWidth = 2 / zoom
      ctx.setLineDash([6 / zoom, 5 / zoom])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  for (const node of nodes) {
    const metric = metrics[node.id] ?? cardMetrics(node, sizes[node.id])
    const follow = follows[node.id] ?? { in: false, out: false }
    drawCard(ctx, node, metric, bitmaps[node.id], editingId === node.id, follow.in, follow.out)
  }

  for (const peer of peers) {
    if (peer.clientId === meId) continue
    drawCursor(ctx, peer)
  }
}

export function hitTest(options: {
  boardX: number
  boardY: number
  zoom: number
  nodes: BoardNode[]
  edges: BoardEdge[]
  sizes: Record<string, Size>
  metrics: Record<string, CardMetrics>
  follows: Record<string, { in: boolean; out: boolean }>
}): Hit {
  const { boardX, boardY, zoom, nodes, edges, sizes, metrics, follows } = options
  const byId = new Map(nodes.map((node) => [node.id, node]))

  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i]
    const metric = metrics[node.id] ?? cardMetrics(node, sizes[node.id])
    const follow = follows[node.id] ?? { in: false, out: false }
    if (
      boardX < node.x - PORT_R ||
      boardY < node.y ||
      boardX > node.x + metric.width + PORT_R ||
      boardY > node.y + metric.height
    ) {
      continue
    }

    const portDx = boardX - (node.x + metric.width)
    const portDy = boardY - (node.y + metric.height / 2)
    if (portDx * portDx + portDy * portDy <= (PORT_R + 4) * (PORT_R + 4)) {
      return { kind: 'port', id: node.id }
    }

    if (
      boardX >= node.x + metric.width - 8 &&
      boardX <= node.x + metric.width + 6 &&
      boardY >= node.y + BAR_HEIGHT &&
      boardY <= node.y + metric.height
    ) {
      return { kind: 'resize', id: node.id }
    }

    if (boardY >= node.y && boardY <= node.y + BAR_HEIGHT && boardX >= node.x && boardX <= node.x + metric.width) {
      for (const slot of buttonSlots(node, metric, follow.in, follow.out)) {
        if (boardX >= slot.x && boardX <= slot.x + slot.w) {
          if (slot.kind === 'follow-in') return { kind: 'follow', id: node.id, direction: 'in' }
          if (slot.kind === 'follow-out') return { kind: 'follow', id: node.id, direction: 'out' }
          if (slot.kind === 'center') return { kind: 'center', id: node.id }
          if (slot.kind === 'edit') return { kind: 'edit', id: node.id }
          return { kind: 'remove', id: node.id }
        }
      }
      return { kind: 'handle', id: node.id }
    }

    if (
      boardX >= node.x &&
      boardX <= node.x + metric.width &&
      boardY >= node.y &&
      boardY <= node.y + metric.height
    ) {
      return { kind: 'card', id: node.id }
    }
  }

  const threshold = 8 / zoom
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const start = anchor(
      from,
      {
        width: metrics[from.id]?.width ?? sizes[from.id]?.width ?? CARD_WIDTH,
        height: metrics[from.id]?.height ?? 140,
      },
      'right',
    )
    const end = anchor(
      to,
      {
        width: metrics[to.id]?.width ?? sizes[to.id]?.width ?? CARD_WIDTH,
        height: metrics[to.id]?.height ?? 140,
      },
      'left',
    )
    const { c1x, c1y, c2x, c2y } = curvePoints(start.x, start.y, end.x, end.y)
    if (distToCubic(boardX, boardY, start.x, start.y, c1x, c1y, c2x, c2y, end.x, end.y) <= threshold) {
      return { kind: 'edge', id: edge.id }
    }
  }

  return { kind: 'board' }
}

export function nodeAtPoint(
  boardX: number,
  boardY: number,
  nodes: BoardNode[],
  metrics: Record<string, CardMetrics>,
  sizes: Record<string, Size>,
): string | null {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i]
    const metric = metrics[node.id] ?? cardMetrics(node, sizes[node.id])
    if (
      boardX >= node.x &&
      boardX <= node.x + metric.width &&
      boardY >= node.y &&
      boardY <= node.y + metric.height
    ) {
      return node.id
    }
  }
  return null
}
