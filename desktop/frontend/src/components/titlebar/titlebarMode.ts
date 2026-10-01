import { useValue } from '@legendapp/state/react'
import { isMac } from '../../lib/shortcuts'
import { windowChrome$ } from '../../lib/windowChrome'

/**
 * Whether Meron draws its own title bar strip: always on macOS (the native one
 * is hidden, see main.go), and on Windows while the integrated title bar is in
 * effect. On Linux the integrated title bar is the pane headers instead
 * (usePaneTitlebar), like GNOME apps' header bars.
 */
export function useTitleBar(): boolean {
  const integrated = useValue(windowChrome$.integrated)
  const windows = useValue(windowChrome$.platform) === 'windows'
  return isMac || (integrated && windows)
}

/**
 * Whether the pane headers are the title bar: the integrated title bar on
 * Linux. They then move the window and hold the window controls, and the pane
 * at the right window edge also holds Tasks and quick settings (TitlebarEnd).
 */
export function usePaneTitlebar(): boolean {
  const integrated = useValue(windowChrome$.integrated)
  const windows = useValue(windowChrome$.platform) === 'windows'
  return !isMac && integrated && !windows
}

/**
 * Whether Tasks and quick settings live in the title bar, strip or pane
 * headers. Otherwise the side navigation keeps them.
 */
export function useTitlebarTools(): boolean {
  const strip = useTitleBar()
  const panes = usePaneTitlebar()
  return strip || panes
}
