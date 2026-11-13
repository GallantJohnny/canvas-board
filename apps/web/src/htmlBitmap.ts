import { sanitizeHtml } from './sanitizeHtml'

const BODY_CSS = [
  'box-sizing:border-box',
  'margin:0',
  'padding:20px 24px 24px',
  'width:100%',
  'font-family:"Segoe UI",system-ui,sans-serif',
  'font-size:21px',
  'line-height:1.45',
  'color:#1b2833',
  'overflow-wrap:anywhere',
  'background:#ffffff',
].join(';')

const CHILD_CSS = `
h2{margin:0 0 8px;font-size:22.5px;letter-spacing:-0.01em;color:#00539f}
p{margin:0 0 8px}
ul{margin:0;padding-left:18px}
li+li{margin-top:4px}
blockquote{margin:0 0 8px;padding-left:10px;border-left:3px solid #00539f;font-style:italic}
.by,.kicker{margin:0;color:#5c6b7a;font-size:18px}
.kicker{margin-bottom:4px;font-size:16.5px;letter-spacing:0.08em;text-transform:uppercase}
.stat{margin:0 0 4px;color:#00539f;font-size:63px;line-height:1;font-weight:650}
:last-child{margin-bottom:0}
`

export type CardBitmap = {
  width: number
  bodyHeight: number
  canvas: HTMLCanvasElement
}

function ensureMeasureRoot(): HTMLDivElement {
  let root = document.getElementById('card-measure-root') as HTMLDivElement | null
  if (root) return root
  root = document.createElement('div')
  root.id = 'card-measure-root'
  root.setAttribute('aria-hidden', 'true')
  root.className = 'card-measure-root'
  document.body.appendChild(root)
  return root
}

function toXhtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const serializer = new XMLSerializer()
  return Array.from(doc.body.childNodes)
    .map((node) => serializer.serializeToString(node))
    .join('')
}

function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

function drawFallback(ctx: CanvasRenderingContext2D, html: string, width: number, height: number) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#1b2833'
  ctx.font = '21px "Segoe UI", system-ui, sans-serif'
  const text = plainText(html) || 'Empty card'
  const words = text.split(' ')
  let line = ''
  let y = 28
  const max = width - 48
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > max && line) {
      ctx.fillText(line, 24, y)
      line = word
      y += 30
      if (y > height - 24) break
    } else {
      line = next
    }
  }
  if (line && y <= height - 24) ctx.fillText(line, 24, y)
}

async function rasterize(html: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const dpr = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const xhtml = toXhtml(sanitizeHtml(html))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${BODY_CSS}"><style>${CHILD_CSS}</style>${xhtml}</div>` +
    `</foreignObject></svg>`

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    ctx.drawImage(image, 0, 0, width, height)
  } catch {
    drawFallback(ctx, html, width, height)
  } finally {
    URL.revokeObjectURL(url)
  }
  return canvas
}

export class CardBitmapCache {
  private cache = new Map<string, CardBitmap>()
  private inflight = new Map<string, Promise<CardBitmap>>()

  measureBodyHeight(html: string, width: number): number {
    const root = ensureMeasureRoot()
    const el = document.createElement('div')
    el.className = 'node-body'
    el.setAttribute('style', `${BODY_CSS};width:${width}px`)
    el.innerHTML = sanitizeHtml(html)
    root.appendChild(el)
    const height = Math.max(40, Math.ceil(Math.max(el.offsetHeight, el.scrollHeight)))
    el.remove()
    return height
  }

  peek(key: string): CardBitmap | undefined {
    return this.cache.get(key)
  }

  key(id: string, html: string, width: number): string {
    return `${id}\n${width}\n${html}`
  }

  async ensure(id: string, html: string, width: number): Promise<CardBitmap> {
    const key = this.key(id, html, width)
    const hit = this.cache.get(key)
    if (hit) return hit
    const pending = this.inflight.get(key)
    if (pending) return pending

    const task = (async () => {
      // Pad a few CSS pixels so font metric differences across OS/DPR cannot clip glyphs.
      const bodyHeight = this.measureBodyHeight(html, width) + 4
      const canvas = await rasterize(html, width, bodyHeight)
      const entry: CardBitmap = { width, bodyHeight, canvas }
      this.cache.set(key, entry)
      this.inflight.delete(key)
      return entry
    })()

    this.inflight.set(key, task)
    try {
      return await task
    } catch (error) {
      this.inflight.delete(key)
      throw error
    }
  }

  prune(live: Iterable<string>) {
    const keep = new Set(live)
    for (const key of this.cache.keys()) {
      const id = key.slice(0, key.indexOf('\n'))
      if (!keep.has(id)) this.cache.delete(key)
    }
  }
}
