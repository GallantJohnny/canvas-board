import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { BoardNode, Size } from './types'

type Props = {
  node: BoardNode
  onResize: (id: string, size: Size) => void
  onDragStart: (id: string, event: ReactPointerEvent<HTMLElement>) => void
  onConnectStart: (id: string, event: ReactPointerEvent<HTMLButtonElement>) => void
}

export function NodeCard({ node, onResize, onDragStart, onConnectStart }: Props) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const publish = () => {
      onResize(node.id, { width: element.offsetWidth, height: element.offsetHeight })
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(element)
    return () => observer.disconnect()
  }, [node.html, node.id, onResize])

  return (
    <section
      ref={ref}
      className="node"
      data-node-id={node.id}
      style={{ left: node.x, top: node.y }}
    >
      <button
        type="button"
        className="node-handle"
        data-drag-handle
        aria-label={`Move ${node.id}`}
        onPointerDown={(event) => onDragStart(node.id, event)}
      >
        <span className="grip" aria-hidden="true" />
      </button>
      <div className="node-body" dangerouslySetInnerHTML={{ __html: node.html }} />
      <span className="inlet" aria-hidden="true" />
      <button
        type="button"
        className="port"
        data-port
        aria-label={`Connect from ${node.id}`}
        onPointerDown={(event) => onConnectStart(node.id, event)}
      />
    </section>
  )
}
