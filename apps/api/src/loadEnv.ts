import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function applyEnvFile(file: string) {
  if (!existsSync(file)) return
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value
  }
}

export function loadLocalEnv() {
  const starts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))]
  const seen = new Set<string>()
  for (const start of starts) {
    let dir = start
    for (let depth = 0; depth < 6; depth += 1) {
      if (seen.has(dir)) break
      seen.add(dir)
      applyEnvFile(path.join(dir, '.env'))
      applyEnvFile(path.join(dir, '.env.local'))
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
}
