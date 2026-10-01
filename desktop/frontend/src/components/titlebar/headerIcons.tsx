import type { CSSProperties, ReactElement } from 'react'
import {
  ChevronLeft,
  Menu,
  MoreHorizontal,
  PanelRight,
  PanelRightClose,
  Plus,
  Search,
  SquareCheckBig,
  SquarePen,
  type LucideIcon,
} from 'lucide-react'
import { useNativeIcon } from '../../lib/nativeIcons'
import { usePaneTitlebar } from './titlebarMode'

export type HeaderIcon = (props: { size?: number; className?: string }) => ReactElement

/**
 * An icon for a button in a pane header. While the pane headers are the title
 * bar (Linux), it is the desktop's own symbolic icon, from the user's icon
 * theme as GTK resolves it (Adwaita on stock GNOME), so the headers read as
 * GNOME header bars: drawn at the 16px it is designed for, on whole pixels,
 * in the full text color. Otherwise, or until the theme answers, the lucide
 * icon the rest of the app uses.
 */
export function headerIcon(name: string, Fallback: LucideIcon): HeaderIcon {
  function Icon({ size, className }: { size?: number; className?: string }) {
    const panes = usePaneTitlebar()
    const mask = useNativeIcon(panes ? name : null)
    if (!mask) return <Fallback size={size} className={className} />
    const style = { WebkitMaskImage: mask, maskImage: mask } as CSSProperties
    return <span aria-hidden data-icon={name} className={`native-icon ${className ?? ''}`} style={style} />
  }
  Icon.displayName = `HeaderIcon(${name})`
  return Icon
}

// freedesktop / Adwaita names for the pane headers' buttons.
export const HeaderMenuIcon = headerIcon('open-menu-symbolic', Menu)
export const HeaderMoreIcon = headerIcon('view-more-horizontal-symbolic', MoreHorizontal)
export const HeaderSearchIcon = headerIcon('system-search-symbolic', Search)
export const HeaderTasksIcon = headerIcon('checkbox-checked-symbolic', SquareCheckBig)
export const HeaderAddIcon = headerIcon('list-add-symbolic', Plus)
export const HeaderBackIcon = headerIcon('go-previous-symbolic', ChevronLeft)
export const HeaderComposeIcon = headerIcon('mail-message-new-symbolic', SquarePen)
// GNOME uses one sidebar icon to show and to hide a side pane.
export const HeaderSidePaneIcon = headerIcon('sidebar-show-right-symbolic', PanelRight)
export const HeaderCloseSidePaneIcon = headerIcon('sidebar-show-right-symbolic', PanelRightClose)
