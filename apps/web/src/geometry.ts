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

export function curve(x1: number, y1: number, x2: number, y2: number) {
  const bend = Math.max(48, Math.abs(x2 - x1) * 0.45)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}
