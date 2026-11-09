import { useEffect, useState } from 'react'
import { Board } from './Board'
import type { Board as BoardData } from './types'

export function App() {
  const [board, setBoard] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetch('/api/board', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Board request failed (${response.status})`)
        return response.json() as Promise<BoardData>
      })
      .then((data) => {
        setBoard(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setBoard(null)
        setLoading(false)
        setError(err instanceof Error ? err.message : 'Could not load the board')
      })
    return () => controller.abort()
  }, [attempt])

  if (loading && !board) {
    return (
      <div className="status">
        <p>Loading board…</p>
      </div>
    )
  }

  if (error || !board) {
    return (
      <div className="status">
        <div className="status-card">
          <p>Could not load the board. Start the API and try again.</p>
          {error ? <p className="status-detail">{error}</p> : null}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return <Board initial={board} />
}
