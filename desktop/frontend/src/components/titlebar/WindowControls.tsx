import { createContext, useContext } from 'react'
import { useValue } from '@legendapp/state/react'
import { useTranslation } from '../../lib/i18n'
import { windowChrome$, windowCommand, type WindowButton } from '../../lib/windowChrome'

/**
 * Which window-control sides a row hosts with the integrated title bar. On
 * Linux, App gives `end` to the rightmost pane and `start` to the first content
 * pane (the side navigation is too narrow for three buttons), and a pane passes
 * it on to whichever of its rows is at the top. TitleBar (Windows, macOS)
 * hosts both. `reserve` and `fold`: how a header keeps room for the end
 * (paneSlots.ts).
 */
export type TitlebarSlots = { start: boolean; end: boolean; reserve?: boolean; fold?: boolean }

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

// The Windows caption glyphs (ChromeMinimize, ChromeMaximize, ChromeRestore,
// ChromeClose) in Segoe Fluent Icons (Windows 11) and Segoe MDL2 Assets
// (Windows 10), which share the code points.
const CAPTION_GLYPHS: Record<WindowButton | 'restore', string> = {
  minimize: '\uE921',
  maximize: '\uE922',
  restore: '\uE923',
  close: '\uE8BB',
}

const COMMAND = { minimize: 'minimise', maximize: 'toggleMaximise', close: 'close' } as const

/**
 * Window controls for one side of the integrated title bar, in the desktop's
 * button layout. Renders nothing with the system title bar, or unless this row
 * hosts that side (useTitlebarSlots). On Windows they
 * are the system's caption buttons: 46px wide, the title bar's full height,
 * flush with the corner. On Linux they are GNOME's, with libadwaita's
 * metrics (1.8 default.css, windowcontrols: a 24px circle with a 16px Adwaita
 * glyph in a button padded 5px, 3px apart; colors in index.css). Circle and
 * glyph are one SVG: as separate boxes the circle landed on fractional pixels
 * while the glyph was snapped to whole ones, leaving it visibly off-centre.
 */
export function WindowControls({ side }: { side: 'start' | 'end' }) {
  const { t } = useTranslation()
  const slots = useTitlebarSlots()
  const integrated = useValue(windowChrome$.integrated)
  const buttons = useValue(windowChrome$.layout[side])
  const maximised = useValue(windowChrome$.maximised)
  const windows = useValue(windowChrome$.platform) === 'windows'

  if (!integrated || !slots[side] || buttons.length === 0) return null

  const label = (button: WindowButton) =>
    button === 'close'
      ? t('buttons.close')
      : button === 'minimize'
        ? t('window.minimize')
        : maximised
          ? t('window.restore')
          : t('window.maximize')

  if (windows) {
    return (
      <div className="flex shrink-0 self-stretch">
        {buttons.map((button) => (
          <button
            key={button}
            type="button"
            className={`caption-button${button === 'close' ? ' caption-button-close' : ''}`}
            aria-label={label(button)}
            title={label(button)}
            onClick={() => windowCommand(COMMAND[button])}
          >
            <span aria-hidden>{CAPTION_GLYPHS[button === 'maximize' && maximised ? 'restore' : button]}</span>
          </button>
        ))}
      </div>
    )
  }

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
