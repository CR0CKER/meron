import { useEffect } from 'react'
import { invoke } from '../../lib/bridge'
import { isMac, matchShortcut } from '../../lib/shortcuts'

// The quit shortcut, kept apart from AppHotkeys so it can be mounted on the
// first-run setup screen too, where the rest of the app's shortcuts have
// nothing to act on. Keystrokes forwarded out of a message iframe are replayed
// on window by AppHotkeys, so they reach this listener as well.
export function QuitHotkey() {
  useEffect(() => {
    // macOS quits natively on ⌘Q.
    if (isMac) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (matchShortcut(event) !== 'app.quit') return
      // The Go side decides: hide to the tray with close-to-tray on, quit with
      // it off.
      event.preventDefault()
      void invoke('app.quit').catch(() => {})
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return null
}
