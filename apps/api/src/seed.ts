import type { Board } from './types.js'

export function createSeed(): Board {
  return {
    nodes: [
      {
        id: 'notes',
        x: 36,
        y: 48,
        html: '<h2>Field notes</h2><p>Each node is a section element. Its body can be any HTML you want on the board.</p>',
      },
      {
        id: 'checklist',
        x: 400,
        y: 36,
        html: '<h2>Open items</h2><ul><li>Drag the handle to move</li><li>Pull from the port to connect</li><li>Click a line to remove it</li></ul>',
      },
      {
        id: 'quote',
        x: 36,
        y: 300,
        html: '<blockquote>The board keeps real HTML, so a node can hold whatever the page needs.</blockquote><p class="by">Studio note</p>',
      },
      {
        id: 'stat',
        x: 400,
        y: 300,
        html: '<p class="kicker">On this board</p><p class="stat">4</p><p>Sections with hardcoded HTML, ready to move and connect.</p>',
      },
    ],
    edges: [
      { id: 'e-notes-checklist', from: 'notes', to: 'checklist' },
      { id: 'e-checklist-quote', from: 'checklist', to: 'quote' },
    ],
  }
}
