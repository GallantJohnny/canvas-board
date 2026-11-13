import { useEffect, useState } from 'react'
import {
  downloadBenchExport,
  getBenchHudState,
  isScenarioRunning,
  parseBenchConfig,
  runAllBenchScenarios,
  runBenchScenario,
  stopBenchScenario,
  subscribeBench,
  type ScenarioName,
} from './bench'

function fmt(ms: number | null | undefined, digits = 1) {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return `${ms.toFixed(digits)}ms`
}

export function BenchHud({ nodeCount }: { nodeCount: number }) {
  const config = parseBenchConfig()
  const [state, setState] = useState(() => getBenchHudState())
  const [cache, setCache] = useState<'unknown' | 'cold' | 'warm'>('unknown')
  const [busy, setBusy] = useState(false)

  useEffect(() => subscribeBench(() => setState(getBenchHudState())), [])

  useEffect(() => {
    if (!config.auto) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled || isScenarioRunning()) return
      setBusy(true)
      void runAllBenchScenarios().finally(() => {
        if (!cancelled) setBusy(false)
      })
    }, 800)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [config.auto])

  async function runOne(name: ScenarioName) {
    if (busy || isScenarioRunning()) return
    setBusy(true)
    await runBenchScenario(name)
    setBusy(false)
  }

  async function runAll() {
    if (busy || isScenarioRunning()) return
    setBusy(true)
    await runAllBenchScenarios()
    setBusy(false)
  }

  const load = state.load

  return (
    <div className="bench-hud" data-chrome>
      <div className="bench-hud-head">
        <strong>Bench</strong>
        <span>{state.path}</span>
      </div>
      <dl className="bench-hud-stats">
        <div>
          <dt>nodes</dt>
          <dd>{nodeCount}</dd>
        </div>
        <div>
          <dt>fps</dt>
          <dd>{state.fps ? state.fps.toFixed(0) : '—'}</dd>
        </div>
        <div>
          <dt>frame</dt>
          <dd>{fmt(state.lastFrameMs)}</dd>
        </div>
        <div>
          <dt>p50</dt>
          <dd>{fmt(state.p50)}</dd>
        </div>
        <div>
          <dt>p95</dt>
          <dd>{fmt(state.p95)}</dd>
        </div>
        <div>
          <dt>run</dt>
          <dd>{state.running ?? '—'}</dd>
        </div>
      </dl>
      <div className="bench-hud-section">
        <p className="bench-hud-label">Load (from navigation)</p>
        <ul className="bench-hud-load">
          <li>DCL {fmt(load.domContentLoaded, 0)}</li>
          <li>load {fmt(load.loadEventEnd, 0)}</li>
          <li>FCP {fmt(load.fcp, 0)}</li>
          <li>LCP {fmt(load.lcp, 0)}</li>
          <li>boot {fmt(load.appBoot, 0)}</li>
          <li>data {fmt(load.boardData, 0)}</li>
          <li>ready {fmt(load.boardReady, 0)}</li>
          <li>interactive {fmt(load.boardInteractive, 0)}</li>
        </ul>
      </div>
      <div className="bench-hud-actions">
        <button type="button" disabled={busy} onClick={() => void runOne('idle')}>
          Idle
        </button>
        <button type="button" disabled={busy} onClick={() => void runOne('pan')}>
          Pan
        </button>
        <button type="button" disabled={busy} onClick={() => void runOne('zoom')}>
          Zoom
        </button>
        <button type="button" disabled={busy} onClick={() => void runOne('drag')}>
          Drag
        </button>
        <button type="button" disabled={busy} onClick={() => void runAll()}>
          Run all
        </button>
        <button type="button" disabled={!busy} onClick={() => stopBenchScenario()}>
          Stop
        </button>
      </div>
      <div className="bench-hud-export">
        <label>
          Cache
          <select value={cache} onChange={(event) => setCache(event.target.value as typeof cache)}>
            <option value="unknown">unknown</option>
            <option value="cold">cold</option>
            <option value="warm">warm</option>
          </select>
        </label>
        <button type="button" onClick={() => downloadBenchExport(cache)}>
          Export JSON
        </button>
      </div>
      {state.results.length ? (
        <ul className="bench-hud-results">
          {state.results.map((result, index) => (
            <li key={`${result.scenario}-${index}`}>
              {result.scenario}: p50 {fmt(result.p50)} / p95 {fmt(result.p95)} / drop {result.dropped}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
