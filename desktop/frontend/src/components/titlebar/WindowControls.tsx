import { createContext, useContext } from 'react'
import { useValue } from '@legendapp/state/react'
import { useTranslation } from '../../lib/i18n'
import { windowChrome$, windowCommand, type WindowButton } from '../../lib/windowChrome'

/**
 * Which window-control sides a pane's top row hosts with the integrated title
 * bar. App gives `end` to the rightmost pane and `start` to the first content
 * pane (the side navigation is too narrow for three buttons); a pane passes it
 * on to whichever of its rows is at the top.
 */
export type TitlebarSlots = { start: boolean; end: boolean }

const TitlebarSlotsContext = createContext<TitlebarSlots>({ start: false, end: false })

export const TitlebarSlotsProvider = TitlebarSlotsContext.Provider

export function useTitlebarSlots(): TitlebarSlots {
  return useContext(TitlebarSlotsContext)
}

// Adwaita's window-*-symbolic glyphs (adwaita-icon-theme, LGPL-3.0 or
// CC-BY-SA-3.0), the ones GTK draws in its own title bar buttons.
const GLYPHS: Record<WindowButton | 'restore', string> = {
  close:
    'm4 4h1.03c.25.01.51.13.69.31l2.28 2.28 2.31-2.28c.27-.23.45-.3.69-.31h1v1c0 .29-.04.55-.25.75l-2.28 2.28 2.25 2.25c.19.19.28.45.28.72v1h-1c-.27 0-.53-.09-.72-.28l-2.28-2.28-2.28 2.28c-.19.19-.45.28-.72.28h-1v-1c0-.27.09-.53.28-.72l2.28-2.25-2.28-2.28c-.21-.2-.3-.47-.28-.75z',
  minimize: 'm4 10.01h8v1.99h-8z',
  maximize: 'm3.99 3.99v8.01h8.01v-8.01zm2 2h4.01v4.01h-4.01z',
  restore: 'm4.99 4.99v6.01h6.01v-6.01zm2 2h2.01v2.01h-2.01z',
}

const COMMAND = { minimize: 'minimise', maximize: 'toggleMaximise', close: 'close' } as const

/**
 * GNOME window controls for one side of the integrated title bar, in the
 * desktop's button layout. Renders nothing unless this row hosts that side.
 * Metrics are libadwaita's (1.8 default.css, windowcontrols): a 24px circle
 * (16px glyph, 4px padding) in a button padded 5px, currentColor at 10% (15%
 * hover, 30% pressed), 3px apart. Circle and glyph are one SVG: as a CSS
 * background the circle landed on fractional pixels while the glyph was
 * snapped to whole ones, leaving the glyph visibly off-centre.
 */
export function WindowControls({ side }: { side: 'start' | 'end' }) {
  const { t } = useTranslation()
  const slots = useTitlebarSlots()
  const integrated = useValue(windowChrome$.integrated)
  const buttons = useValue(windowChrome$.layout[side])
  const maximised = useValue(windowChrome$.maximised)

  if (!integrated || !slots[side] || buttons.length === 0) return null

  const label = (button: WindowButton) =>
    button === 'close'
      ? t('window.close')
      : button === 'minimize'
        ? t('window.minimize')
        : maximised
          ? t('window.restore')
          : t('window.maximize')

  return (
    <div className="window-controls flex shrink-0 items-center gap-[3px]">
      {buttons.map((button) => (
        <button
          key={button}
          type="button"
          className="window-control"
          aria-label={label(button)}
          title={label(button)}
          onClick={() => windowCommand(COMMAND[button])}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
            <circle className="window-control-circle" cx="12" cy="12" r="12" />
            <path
              d={GLYPHS[button === 'maximize' && maximised ? 'restore' : button]}
              transform="translate(4 4)"
              fill="currentColor"
            />
          </svg>
        </button>
      ))}
    </div>
  )
}

/**
 * A header-height title bar row for a pane that has no header of its own
 * (the empty conversation, the setup screen): a drag region holding only the
 * window controls. Nothing without the integrated title bar.
 */
export function TitlebarStrip() {
  const slots = useTitlebarSlots()
  const integrated = useValue(windowChrome$.integrated)
  if (!integrated || (!slots.start && !slots.end)) return null
  return (
    <div data-titlebar className="flex h-12 shrink-0 items-center px-2">
      <WindowControls side="start" />
      <div className="flex-1" />
      <WindowControls side="end" />
    </div>
  )
}
