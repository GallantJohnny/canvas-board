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
  return (
    typeof HTMLCanvasElement !== 'undefined' &&
    'content' in HTMLCanvasElement.prototype &&
    typeof CanvasRenderingContext2D !== 'undefined' &&
    typeof (CanvasRenderingContext2D.prototype as { drawElementImage?: unknown }).drawElementImage ===
      'function'
  )
}

export function asHtmlInCanvas(canvas: HTMLCanvasElement | null): HtmlInCanvasElement | null {
  if (!canvas || !supportsHtmlInCanvas()) return null
  return canvas as HtmlInCanvasElement
}

export function asHtmlInCanvasContext(ctx: CanvasRenderingContext2D | null): HtmlInCanvasContext2D | null {
  if (!ctx || typeof (ctx as HtmlInCanvasContext2D).drawElementImage !== 'function') return null
  return ctx as HtmlInCanvasContext2D
}
