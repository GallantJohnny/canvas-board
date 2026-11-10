import { html } from '@codemirror/lang-html'
import { EditorView, placeholder } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'

const PLACEHOLDER = '<h2>Title</h2>\n<p>Write the card as HTML.</p>'

const companyTheme = EditorView.theme({
  '&': {
    backgroundColor: '#ffffff',
    color: '#1b2833',
  },
  '.cm-content': {
    caretColor: '#00539f',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#00539f',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(0, 83, 159, 0.18)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(0, 83, 159, 0.06)',
  },
  '.cm-gutters': {
    backgroundColor: '#f4f7fb',
    color: '#5c6b7a',
    borderRight: '1px solid #d5e0ea',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#e6f0f8',
    color: '#00539f',
  },
  '.cm-tooltip': {
    backgroundColor: '#ffffff',
    color: '#1b2833',
    border: '1px solid #d5e0ea',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: '#00539f',
    color: '#ffffff',
  },
})

type Props = {
  value: string
  onChange: (value: string) => void
}

export function HtmlEditor({ value, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  onChangeRef.current = onChange
  valueRef.current = value

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      parent: host,
      doc: valueRef.current,
      extensions: [
        basicSetup,
        html(),
        companyTheme,
        EditorView.lineWrapping,
        placeholder(PLACEHOLDER),
        EditorView.contentAttributes.of({
          id: 'card-html',
          'aria-labelledby': 'card-html-label',
          spellcheck: 'false',
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
      ],
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    })
  }, [value])

  return <div ref={hostRef} className="composer-editor" />
}
