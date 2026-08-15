import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { applyTheme } from './theme'
import './styles.css'

// Before `createRoot`, so the first paint is already the right theme. The usual
// trick — an inline <script> in index.html — is unavailable here: the CSP is
// `script-src 'self'` with no `'unsafe-inline'`. A module script is `'self'`, and
// this runs synchronously ahead of React, so it does the same job. Main paints the
// window chrome to the same colour before Chromium starts, which covers the frames
// before this file even loads.
applyTheme(window.aperture.theme.initial)

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
