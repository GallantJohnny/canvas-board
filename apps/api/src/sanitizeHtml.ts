import sanitizeHtmlLib from 'sanitize-html'

/** Mirror the web board sanitizer: strip scripts and author CSS, keep tags + classes. */
const OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: sanitizeHtmlLib.defaults.allowedTags.filter(
    (tag) => !['style', 'form', 'input', 'textarea', 'select', 'option', 'button'].includes(tag),
  ),
  allowedAttributes: {
    ...sanitizeHtmlLib.defaults.allowedAttributes,
    '*': ['class', 'title', 'lang', 'dir'],
    a: ['href', 'name', 'target', 'rel'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
}

export function sanitizeHtml(html: string): string {
  return sanitizeHtmlLib(html, OPTIONS)
}
