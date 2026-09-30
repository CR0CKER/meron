import { observable } from '@legendapp/state'
import { invoke } from './bridge'

// The integrated title bar (Linux): GTK draws the window frame but no title
// bar, and the pane headers take its place, drawing the window controls
// themselves. Button set, side and double-click action follow the desktop
// (GNOME's button-layout and action-double-click-titlebar, as GTK reports
// them) instead of settings of our own.

export type WindowButton = 'minimize' | 'maximize' | 'close'

export type DecorationLayout = { start: WindowButton[]; end: WindowButton[] }

type WindowChromeReply = { supported?: boolean; integrated?: boolean; layout?: string; doubleClick?: string }

export const windowChrome$ = observable({
  /** Whether this platform can drop the title bar (Linux only). */
  supported: false,
  integrated: false,
  layout: { start: [], end: ['close'] } as DecorationLayout,
  doubleClick: 'toggle-maximize',
  maximised: false,
})

const BUTTONS: readonly string[] = ['minimize', 'maximize', 'close']

/**
 * Parse GTK's decoration layout ("appmenu:minimize,maximize,close"): buttons
 * before the colon go on the left, after it on the right. Entries that aren't
 * window buttons (appmenu, menu, icon) are dropped, and so are repeats.
 */
export function parseDecorationLayout(layout: string): DecorationLayout {
  const seen = new Set<string>()
  const side = (part: string | undefined) =>
    (part ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => BUTTONS.includes(name) && !seen.has(name) && seen.add(name)) as WindowButton[]
  const colon = layout.indexOf(':')
  if (colon === -1) return { start: [], end: side(layout) }
  const start = side(layout.slice(0, colon))
  return { start, end: side(layout.slice(colon + 1)) }
}

function applyReply(reply: WindowChromeReply) {
  windowChrome$.supported.set(reply.supported === true)
  windowChrome$.integrated.set(reply.integrated === true)
  if (typeof reply.layout === 'string' && reply.layout !== '') {
    windowChrome$.layout.set(parseDecorationLayout(reply.layout))
  }
  if (typeof reply.doubleClick === 'string' && reply.doubleClick !== '') {
    windowChrome$.doubleClick.set(reply.doubleClick)
  }
  document.documentElement.classList.toggle('titlebar-integrated', reply.integrated === true)
}

export async function loadWindowChrome() {
  applyReply(await invoke<WindowChromeReply>('window.chrome'))
}

export async function setIntegratedTitlebar(integrated: boolean) {
  await invoke('window.setTitlebar', { integrated })
  await loadWindowChrome()
}

export function windowCommand(command: 'minimise' | 'toggleMaximise' | 'close') {
  void invoke(`window.${command}`).catch(() => {})
}

const INTERACTIVE = 'button, a, input, textarea, select, [role="button"], [contenteditable="true"]'

/** The action GNOME runs for a double-click on a title bar, if we can do it. */
export function doubleClickCommand(action: string): 'minimise' | 'toggleMaximise' | null {
  if (action === 'toggle-maximize') return 'toggleMaximise'
  if (action === 'minimize') return 'minimise'
  // toggle-maximize-horizontally/-vertically, lower, menu and none have no
  // Wails equivalent; doing nothing is closest for all of them.
  return null
}

/**
 * Double-clicking empty space in a title bar region runs the desktop's
 * double-click action; the button layout is re-read when the window regains
 * focus, since it can change in GNOME Settings meanwhile.
 */
export function installWindowChrome(): () => void {
  const onDoubleClick = (event: MouseEvent) => {
    if (!windowChrome$.integrated.peek() || event.button !== 0) return
    const target = event.target as Element | null
    if (!target?.closest('[data-titlebar]') || target.closest(INTERACTIVE)) return
    const command = doubleClickCommand(windowChrome$.doubleClick.peek())
    if (command) windowCommand(command)
  }
  const onFocus = () => {
    void loadWindowChrome().catch(() => {})
  }
  window.addEventListener('dblclick', onDoubleClick)
  window.addEventListener('focus', onFocus)
  onFocus()
  return () => {
    window.removeEventListener('dblclick', onDoubleClick)
    window.removeEventListener('focus', onFocus)
  }
}
