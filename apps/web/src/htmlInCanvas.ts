/** Chrome 157+ HTML-in-Canvas (`content="drawable"` + `drawElementImage`). */

export type DrawElementImageOptions = {
  preserveElementGeometry?: boolean
}

export type HtmlInCanvasContext2D = CanvasRenderingContext2D & {
  drawElementImage(element: Element, dx: number, dy: number, options?: DrawElementImageOptions): void
  drawElementImage(
    element: Element,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number,
    options?: DrawElementImageOptions,
  ): void
}

export type HtmlInCanvasElement = HTMLCanvasElement & {
  requestPaint(): void
  clearElementGeometry(element: Element): void
}

export type CanvasPaintEvent = Event & {
  changedElements: Element[]
}

export function supportsHtmlInCanvas(): boolean {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false
  const canvas = document.createElement('canvas')
  canvas.setAttribute('content', 'drawable')
  // Chrome sets the reflected content property when the HTML-in-Canvas API is available.
  return (canvas as HTMLCanvasElement & { content?: string }).content === 'drawable'
}

export type ElementImageSize = { width: number; height: number }

export function getElementImageDefaultSize(
  canvas: HTMLCanvasElement,
  element: Element,
): ElementImageSize | null {
  const api = canvas as HTMLCanvasElement & {
    getElementImageDefaultSize?: (el: Element) => ElementImageSize
  }
  if (typeof api.getElementImageDefaultSize !== 'function') return null
  try {
    return api.getElementImageDefaultSize(element)
  } catch {
    return null
  }
}

export function asHtmlInCanvas(canvas: HTMLCanvasElement | null): HtmlInCanvasElement | null {
  if (!canvas || !supportsHtmlInCanvas()) return null
  return canvas as HtmlInCanvasElement
}

export function asHtmlInCanvasContext(ctx: CanvasRenderingContext2D | null): HtmlInCanvasContext2D | null {
  if (!ctx || typeof (ctx as HtmlInCanvasContext2D).drawElementImage !== 'function') return null
  return ctx as HtmlInCanvasContext2D
}
