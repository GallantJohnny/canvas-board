import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { CARD_WIDTH } from './geometry'
import type { BoardNode, Size } from './types'

type Props = {
  node: BoardNode
  onResize: (id: string, size: Size) => void
  onResizeStart: (id: string, event: ReactPointerEvent<HTMLButtonElement>) => void
  onResizeKey: (id: string, event: ReactKeyboardEvent<HTMLButtonElement>) => void
  onDragStart: (id: string, event: ReactPointerEvent<HTMLElement>) => void
  onConnectStart: (id: string, event: ReactPointerEvent<HTMLButtonElement>) => void
  onCenter: (id: string) => void
  onFollow: (id: string, direction: 'in' | 'out') => void
  canFollowIn: boolean
  canFollowOut: boolean
  editing: boolean
  onEdit: (id: string) => void
  onRemove: (id: string) => void
}

export function NodeCard({
  node,
  onResize,
  onResizeStart,
  onResizeKey,
  onDragStart,
  onConnectStart,
  onCenter,
  onFollow,
  canFollowIn,
  canFollowOut,
  editing,
  onEdit,
  onRemove,
}: Props) {
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
      className={editing ? 'node is-editing' : 'node'}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: node.width ?? CARD_WIDTH }}
    >
      <div className="node-bar">
        <button
          type="button"
          className="node-handle"
          data-drag-handle
          aria-label={`Move ${node.id}`}
          onPointerDown={(event) => onDragStart(node.id, event)}
        >
          <span className="grip" aria-hidden="true" />
        </button>
        {canFollowIn ? (
          <button
            type="button"
            className="node-follow"
            aria-label={`Previous card connected to ${node.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onFollow(node.id, 'in')}
          >
            <span aria-hidden="true">←</span>
          </button>
        ) : null}
        {canFollowOut ? (
          <button
            type="button"
            className="node-follow"
            aria-label={`Next card connected to ${node.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onFollow(node.id, 'out')}
          >
            <span aria-hidden="true">→</span>
          </button>
        ) : null}
        <button
          type="button"
          className="node-center"
          aria-label={`Center ${node.id}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onCenter(node.id)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="node-edit"
          aria-label={`Edit ${node.id}`}
          aria-pressed={editing}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onEdit(node.id)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M9.4 2.6 13.4 6.6 6.2 13.8H2.2V9.8L9.4 2.6Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M8 4 12 8" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        <button
          type="button"
          className="node-remove"
          aria-label={`Remove ${node.id}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onRemove(node.id)}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="node-body" dangerouslySetInnerHTML={{ __html: node.html }} />
      <span className="inlet" aria-hidden="true" />
      <button
        type="button"
        className="node-resize"
        aria-label={`Resize ${node.id}`}
        onPointerDown={(event) => onResizeStart(node.id, event)}
        onKeyDown={(event) => onResizeKey(node.id, event)}
      />
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
