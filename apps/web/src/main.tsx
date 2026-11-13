import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { markAppBoot } from './bench'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

markAppBoot()
document.documentElement.dataset.benchBranch = 'canvas'

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
