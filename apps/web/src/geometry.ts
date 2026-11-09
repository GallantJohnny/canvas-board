import type { BoardNode, Size } from './types'

export function anchor(node: BoardNode, size: Size | undefined, side: 'left' | 'right') {
  const width = size?.width ?? 280
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
