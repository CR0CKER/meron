import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './lib/i18n'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// WebKitGTK draws GNOME-style overlay scrollbars (no gutter, fade out when
// idle) unless the page styles them, so index.css leaves them alone on Linux.
document.documentElement.classList.toggle('native-scrollbars', /linux/i.test(navigator.userAgent))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
