import type { BoardEdge, BoardNode, BoardSnapshot } from './types'

export type BenchHtmlMode = 'simple' | 'rich'
export type RenderPath = 'dom' | 'html-in-canvas' | 'bitmap-fallback'

export type BenchConfig = {
  enabled: boolean
  n: number
  html: BenchHtmlMode
  auto: boolean
}

export type LoadMetrics = {
  navigationStart: number
  domContentLoaded: number | null
  loadEventEnd: number | null
  fcp: number | null
  lcp: number | null
  appBoot: number | null
  boardData: number | null
  boardReady: number | null
  boardInteractive: number | null
  transferBytes: number | null
}

export type ScenarioName = 'idle' | 'pan' | 'zoom' | 'drag'
export type ScenarioResult = {
  scenario: ScenarioName
  n: number
  path: RenderPath
  samples: number
  p50: number
  p95: number
  max: number
  dropped: number
  mean: number
}

export type BenchExport = {
  branch: string
  path: RenderPath
  n: number
  html: BenchHtmlMode
  cache: 'unknown' | 'cold' | 'warm'
  startedAt: string
  load: LoadMetrics
  scenarios: ScenarioResult[]
}

export type BenchDriver = {
  getPan: () => { x: number; y: number }
  setPan: (pan: { x: number; y: number }) => void
  getZoom: () => number
  setZoom: (zoom: number) => void
  getFirstNodeId: () => string | null
  previewMove: (id: string, x: number, y: number) => void
  getNodeOrigin: (id: string) => { x: number; y: number } | null
}

const SIMPLE_HTML =
  '<h2>Bench card</h2><p>Short body used for synthetic load tests.</p>'
const RICH_HTML = [
  '<h2>Rich bench card</h2>',
  '<p>Longer markup exercises HTML layout and raster cost under load.</p>',
  '<ul><li>Item one with detail</li><li>Item two with detail</li><li>Item three with detail</li></ul>',
  '<blockquote>Quoted note for density.</blockquote>',
  '<p class="by">Studio note</p>',
].join('')

const WINDOW = 120
const DROP_MS = 20

let bootMarked = false
let boardDataMarked = false
let boardReadyMarked = false
let boardInteractiveMarked = false
let paintObserver: PerformanceObserver | null = null
let lcpObserver: PerformanceObserver | null = null

const load: LoadMetrics = {
  navigationStart: 0,
  domContentLoaded: null,
  loadEventEnd: null,
  fcp: null,
  lcp: null,
  appBoot: null,
  boardData: null,
  boardReady: null,
  boardInteractive: null,
  transferBytes: null,
}

let frameSamples: number[] = []
let lastFrameAt = 0
let lastFrameMs = 0
let fps = 0
let path: RenderPath = 'dom'
let driver: BenchDriver | null = null
let running: ScenarioName | null = null
let scenarioSamples: number[] = []
let scenarioAbort: (() => void) | null = null
const scenarioResults: ScenarioResult[] = []
const listeners = new Set<() => void>()

export function parseBenchConfig(search = window.location.search): BenchConfig {
  const params = new URLSearchParams(search)
  const enabled = params.get('bench') === '1' || params.get('bench') === 'true'
  const nRaw = Number(params.get('n') ?? '50')
  const n = Number.isFinite(nRaw) ? Math.max(1, Math.min(500, Math.floor(nRaw))) : 50
  const htmlParam = params.get('html')
  const html: BenchHtmlMode = htmlParam === 'rich' ? 'rich' : 'simple'
  const auto = params.get('auto') === '1' || params.get('auto') === 'true'
  return { enabled, n, html, auto }
}

export function createBenchSnapshot(n: number, html: BenchHtmlMode): BoardSnapshot {
  const body = html === 'rich' ? RICH_HTML : SIMPLE_HTML
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const gapX = 320
  const gapY = 220
  const nodes: BoardNode[] = []
  for (let i = 0; i < n; i += 1) {
    const col = i % cols
    const row = Math.floor(i / cols)
    nodes.push({
      id: `bench-${i}`,
      x: 40 + col * gapX,
      y: 40 + row * gapY,
      html: `${body}<p class="kicker">#${i + 1}</p>`,
      width: 280,
    })
  }
  const edges: BoardEdge[] = []
  for (let i = 0; i < n - 1; i += 1) {
    if (i % 3 !== 0) continue
    edges.push({
      id: `bench-e-${i}`,
      from: `bench-${i}`,
      to: `bench-${i + 1}`,
    })
  }
  return { revision: 1, nodes, edges }
}

function notify() {
  for (const listener of listeners) listener()
}

export function subscribeBench(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function markAppBoot() {
  if (bootMarked) return
  bootMarked = true
  load.appBoot = performance.now()
  performance.mark('app-boot')
  captureNavigation()
  observePaints()
  notify()
}

export function markBoardData() {
  if (boardDataMarked) return
  boardDataMarked = true
  load.boardData = performance.now()
  performance.mark('board-data')
  if (load.appBoot != null) {
    try {
      performance.measure('boot-to-board-data', 'app-boot', 'board-data')
    } catch {
      // ignore missing marks
    }
  }
  notify()
}

export function markBoardReady() {
  if (boardReadyMarked) return
  boardReadyMarked = true
  load.boardReady = performance.now()
  performance.mark('board-ready')
  if (load.appBoot != null) {
    try {
      performance.measure('boot-to-board-ready', 'app-boot', 'board-ready')
    } catch {
      // ignore
    }
  }
  notify()
}

export function markBoardInteractive() {
  if (boardInteractiveMarked) return
  boardInteractiveMarked = true
  load.boardInteractive = performance.now()
  performance.mark('board-interactive')
  if (load.appBoot != null) {
    try {
      performance.measure('boot-to-board-interactive', 'app-boot', 'board-interactive')
    } catch {
      // ignore
    }
  }
  notify()
}

function captureNavigation() {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (nav) {
    load.navigationStart = nav.startTime
    load.domContentLoaded = nav.domContentLoadedEventEnd
    load.loadEventEnd = nav.loadEventEnd
  } else if (performance.timing) {
    const timing = performance.timing
    load.navigationStart = 0
    load.domContentLoaded = timing.domContentLoadedEventEnd - timing.navigationStart
    load.loadEventEnd = timing.loadEventEnd - timing.navigationStart
  }
  let bytes = 0
  for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    if (entry.transferSize) bytes += entry.transferSize
  }
  load.transferBytes = bytes || null
}

function observePaints() {
  if (typeof PerformanceObserver === 'undefined') return
  try {
    paintObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint' && load.fcp == null) {
          load.fcp = entry.startTime
          notify()
        }
      }
    })
    paintObserver.observe({ type: 'paint', buffered: true })
  } catch {
    paintObserver = null
  }
  try {
    lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1]
      if (last) {
        load.lcp = last.startTime
        notify()
      }
    })
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {
    lcpObserver = null
  }
}

export function setBenchRenderPath(next: RenderPath) {
  path = next
  notify()
}

export function registerBenchDriver(next: BenchDriver | null) {
  driver = next
  notify()
}

export function noteBenchFrame(durationMs?: number) {
  const now = performance.now()
  const delta = durationMs ?? (lastFrameAt > 0 ? now - lastFrameAt : 0)
  lastFrameAt = now
  if (!(delta > 0) || delta > 1000) return
  lastFrameMs = delta
  frameSamples.push(delta)
  if (frameSamples.length > WINDOW) frameSamples.shift()
  fps = 1000 / mean(frameSamples)
  if (running) scenarioSamples.push(delta)
  notify()
}

export function getBenchHudState() {
  const sorted = [...frameSamples].sort((a, b) => a - b)
  return {
    path,
    fps,
    lastFrameMs,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    samples: frameSamples.length,
    running,
    results: scenarioResults.slice(),
    load: { ...load },
  }
}

export function isScenarioRunning() {
  return running != null
}

export async function runBenchScenario(name: ScenarioName, durationMs = 4000): Promise<ScenarioResult | null> {
  if (!driver || running) return null
  running = name
  scenarioSamples = []
  notify()

  const config = parseBenchConfig()
  const startedPan = driver.getPan()
  const startedZoom = driver.getZoom()
  const nodeId = driver.getFirstNodeId()
  const origin = nodeId ? driver.getNodeOrigin(nodeId) : null

  let cancelled = false
  scenarioAbort = () => {
    cancelled = true
  }

  const endAt = performance.now() + durationMs
  await new Promise<void>((resolve) => {
    const step = (now: number) => {
      if (cancelled || now >= endAt) {
        resolve()
        return
      }
      const t = (now - (endAt - durationMs)) / durationMs
      if (name === 'pan') {
        driver?.setPan({
          x: startedPan.x + Math.sin(t * Math.PI * 4) * 180,
          y: startedPan.y + Math.cos(t * Math.PI * 3) * 120,
        })
      } else if (name === 'zoom') {
        const zoom = 0.25 + ((Math.floor(t * 8) % 8) / 7) * (2 - 0.25)
        driver?.setZoom(zoom)
      } else if (name === 'drag' && nodeId && origin) {
        driver?.previewMove(
          nodeId,
          origin.x + Math.sin(t * Math.PI * 6) * 140,
          origin.y + Math.cos(t * Math.PI * 4) * 90,
        )
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })

  if (name === 'pan') driver.setPan(startedPan)
  if (name === 'zoom') driver.setZoom(startedZoom)
  if (name === 'drag' && nodeId && origin) driver.previewMove(nodeId, origin.x, origin.y)

  const sorted = [...scenarioSamples].sort((a, b) => a - b)
  const result: ScenarioResult = {
    scenario: name,
    n: config.n,
    path,
    samples: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.length ? sorted[sorted.length - 1]! : 0,
    dropped: sorted.filter((ms) => ms > DROP_MS).length,
    mean: mean(sorted),
  }
  scenarioResults.push(result)
  running = null
  scenarioAbort = null
  notify()
  return result
}

export async function runAllBenchScenarios() {
  const names: ScenarioName[] = ['idle', 'pan', 'zoom', 'drag']
  for (const name of names) {
    await runBenchScenario(name)
  }
}

export function stopBenchScenario() {
  scenarioAbort?.()
}

export function buildBenchExport(cache: BenchExport['cache'] = 'unknown'): BenchExport {
  const config = parseBenchConfig()
  captureNavigation()
  return {
    branch: document.documentElement.dataset.benchBranch || 'unknown',
    path,
    n: config.n,
    html: config.html,
    cache,
    startedAt: new Date().toISOString(),
    load: { ...load },
    scenarios: scenarioResults.slice(),
  }
}

export function downloadBenchExport(cache: BenchExport['cache'] = 'unknown') {
  const payload = buildBenchExport(cache)
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `bench-${payload.path}-n${payload.n}-${Date.now()}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function mean(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[index] ?? 0
}
