import { useEffect, useState, type FormEvent } from 'react'
import { Board } from './Board'
import type { BoardSnapshot } from './types'
import { savedName } from './useBoardSync'

export function App() {
  const [board, setBoard] = useState<BoardSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [name, setName] = useState<string | null>(() => savedName())

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetch('/api/board', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null)
          const detail =
            typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
              ? body.error
              : `Board request failed (${response.status})`
          throw new Error(detail)
        }
        return response.json() as Promise<BoardSnapshot>
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

  if (!name) return <NamePrompt onJoin={setName} />

  return <Board initial={board} name={name} />
}

function NamePrompt({ onJoin }: { onJoin: (name: string) => void }) {
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trimmed) return
    onJoin(trimmed.slice(0, 24))
  }

  return (
    <div className="status">
      <form className="status-card name-prompt" onSubmit={submit}>
        <h1>Join the board</h1>
        <p>Enter your name so other people can see who is here.</p>
        <label htmlFor="board-name">Name</label>
        <input
          id="board-name"
          name="name"
          autoFocus
          maxLength={24}
          autoComplete="nickname"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={!trimmed}>
          Enter
        </button>
      </form>
    </div>
  )
}
