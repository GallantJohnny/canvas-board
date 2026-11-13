#!/usr/bin/env node
/**
 * Headless bench runner for canvas vs DOM board branches.
 * Usage: node scripts/run-bench.mjs --label canvas --out /tmp/bench-canvas.json
 * Expects the app already listening on BASE_URL (default http://127.0.0.1:5173).
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i]
  if (!key.startsWith('--')) continue
  args.set(key.slice(2), process.argv[i + 1] ?? 'true')
  i += 1
}

const baseUrl = args.get('base') || process.env.BASE_URL || 'http://127.0.0.1:5173'
const label = args.get('label') || 'unknown'
const outPath = args.get('out') || `/tmp/bench-${label}.json`
const ns = (args.get('n') || '10,50,100,200').split(',').map((value) => Number(value.trim())).filter(Boolean)
const reloads = Math.max(1, Number(args.get('reloads') || 5))
const html = args.get('html') || 'simple'

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function pct(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[index]
}

async function waitForBench(page) {
  await page.waitForFunction(() => Boolean(window.__BENCH__), null, { timeout: 30_000 })
  await page.waitForFunction(() => {
    const state = window.__BENCH__?.getState()
    return Boolean(state?.load?.boardReady != null && state?.load?.boardInteractive != null)
  }, null, { timeout: 60_000 })
}

async function collectLoad(page, n) {
  const samples = []
  for (let i = 0; i < reloads; i += 1) {
    await page.goto(`${baseUrl}/?bench=1&n=${n}&html=${html}`, { waitUntil: 'networkidle' })
    await waitForBench(page)
    const load = await page.evaluate(() => window.__BENCH__.export('warm').load)
    samples.push(load)
  }
  const pick = (key) => samples.map((sample) => sample[key]).filter((value) => typeof value === 'number')
  return {
    samples: samples.length,
    median: {
      domContentLoaded: median(pick('domContentLoaded')),
      loadEventEnd: median(pick('loadEventEnd')),
      fcp: median(pick('fcp')),
      lcp: median(pick('lcp')),
      appBoot: median(pick('appBoot')),
      boardData: median(pick('boardData')),
      boardReady: median(pick('boardReady')),
      boardInteractive: median(pick('boardInteractive')),
    },
    p95: {
      boardReady: pct(pick('boardReady'), 0.95),
      boardInteractive: pct(pick('boardInteractive'), 0.95),
    },
  }
}

async function collectScenarios(page, n) {
  await page.goto(`${baseUrl}/?bench=1&n=${n}&html=${html}`, { waitUntil: 'networkidle' })
  await waitForBench(page)
  await page.evaluate(async () => {
    await window.__BENCH__.runAll()
  })
  return page.evaluate(() => window.__BENCH__.export('warm'))
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const results = { label, baseUrl, html, viewport: { width: 1440, height: 900 }, runs: [] }

  for (const n of ns) {
    console.error(`[${label}] n=${n} load…`)
    const load = await collectLoad(page, n)
    console.error(`[${label}] n=${n} scenarios…`)
    const scenarios = await collectScenarios(page, n)
    results.runs.push({
      n,
      path: scenarios.path,
      branch: scenarios.branch,
      load,
      scenarios: scenarios.scenarios,
    })
  }

  await browser.close()
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(results, null, 2))
  console.log(outPath)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
