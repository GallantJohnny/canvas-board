import DOMPurify from 'dompurify'

/** Safe card markup: no scripts, no author CSS, keep structural HTML + classes. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'link', 'base', 'meta', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style'],
  })
}

export function hasHtmlElement(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.body.childNodes).some((node) => node.nodeType === Node.ELEMENT_NODE)
}
