const fs = require('fs')

fs.rmSync('public', { recursive: true, force: true })
fs.cpSync('apps/web/dist', 'public', { recursive: true })
