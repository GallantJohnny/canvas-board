import type { BoardNode, Size } from './types'

export const CARD_WIDTH = 280
export const MIN_CARD_WIDTH = 180
export const MAX_CARD_WIDTH = 720

export function clampCardWidth(width: number) {
  if (!Number.isFinite(width)) return CARD_WIDTH
  return Math.round(Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, width)))
}

export function anchor(node: BoardNode, size: Size | undefined, side: 'left' | 'right') {
  const width = size?.width ?? CARD_WIDTH
  const height = size?.height ?? 140
  return {
    x: node.x + (side === 'right' ? width : 0),
    y: node.y + height / 2,
  }
}

export function curvePoints(x1: number, y1: number, x2: number, y2: number) {
  const bend = Math.max(48, Math.abs(x2 - x1) * 0.45)
  return {
    c1x: x1 + bend,
    c1y: y1,
    c2x: x2 - bend,
    c2y: y2,
  }
}

export function curve(x1: number, y1: number, x2: number, y2: number) {
  const { c1x, c1y, c2x, c2y } = curvePoints(x1, y1, x2, y2)
  return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`
}
