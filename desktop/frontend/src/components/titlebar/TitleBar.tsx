import { useState, type Dispatch, type MouseEvent, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { Menu, SquareCheckBig } from 'lucide-react'
import { useValue } from '@legendapp/state/react'
import { useTranslation } from '../../lib/i18n'
import { isMac } from '../../lib/shortcuts'
import { windowChrome$ } from '../../lib/windowChrome'
import { settings$ } from '../../states/settings'
import { toggleTasksPanel } from '../../states/tasks'
import { ui$ } from '../../states/ui'
import { IconButton } from '../button/IconButton'
import { BoardDialog, type BoardDialogState } from '../sidenav/BoardDialog'
import { QuickSettingsMenu } from '../sidenav/QuickSettingsMenu'
import { TitlebarSlotsProvider, useTitlebarSlots, WindowControls } from './WindowControls'
import { usePaneTitlebar, useTitleBar } from './titlebarMode'
import { HeaderMenuIcon, HeaderTasksIcon } from './headerIcons'

export { usePaneTitlebar, useTitleBar, useTitlebarTools } from './titlebarMode'

type MenuPosition = { x: number; y: number } | null

type MenuProps = { menu: MenuPosition; setMenu: Dispatch<SetStateAction<MenuPosition>> }

const BOTH_SLOTS = { start: true, end: true }
const END_SLOT = { start: false, end: true }

/**
 * The window's top row on macOS and Windows, in the side navigation's colors
 * so the two read as one frame. It moves the window ([data-titlebar] in
 * index.css) and holds the app-wide Tasks and quick-settings buttons, plus the
 * window controls on Windows.
 * On macOS it stays at the hidden title bar's height so the traffic lights,
 * which float over its left end, stay centred in it.
 */
export function TitleBar({ tools = true }: { tools?: boolean }) {
  const [menu, setMenu] = useState<MenuPosition>(null)
  const shown = useTitleBar()
  if (!shown) return null
  // macOS: the hidden title bar's height, clear of the traffic lights. Windows:
  // the caption's 32px, the caption buttons flush with the right edge.
  const layout = isMac ? 'h-7 pr-2 pl-20' : 'h-8 pl-1.5'
  return (
    <div
      data-titlebar
      className={`flex shrink-0 items-center bg-sidenav text-sidenav-ink ${layout}`}
      onContextMenu={(event) => {
        if (!tools || event.defaultPrevented) return
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <TitlebarSlotsProvider value={BOTH_SLOTS}>
        <WindowControls side="start" />
        <div className="flex-1" />
        {tools && <TitleBarTools menu={menu} setMenu={setMenu} />}
        <WindowControls side="end" />
      </TitlebarSlotsProvider>
      <TitleBarMenus menu={menu} setMenu={setMenu} />
    </div>
  )
}

/** The window-edge group: the Tasks toggle, then the window controls, set
 * apart by a divider so the window's close button never reads as a pane's. */
function EdgeGroupButtons() {
  const endButtons = useValue(windowChrome$.layout.end)
  return (
    <>
      <PaneTasksToggle />
      {endButtons.length > 0 && <div aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />}
      {/* The controls check their own slot; both copies of the group draw them. */}
      <TitlebarSlotsProvider value={END_SLOT}>
        <WindowControls side="end" />
      </TitlebarSlotsProvider>
    </>
  )
}

/**
 * The room for the window-edge group at the end of the header at the right
 * window edge (Linux), or of the header that gets it back when Tasks or the
 * details panel closes (`reserve`). It is an invisible copy of the group, so
 * exactly its width, out of reach and out of the accessibility tree: the
 * group itself is drawn once over the corner (WindowEdgeGroup), so it never
 * moves or redraws when panes open, close or slide.
 */
export function TitlebarEnd() {
  const slots = useTitlebarSlots()
  const panes = usePaneTitlebar()
  const room = slots.end || !!slots.reserve
  if (!panes || (!room && !slots.fold)) return null
  // .titlebar-end: index.css gives every header that holds it the same inset
  // from the window edge, which WindowEdgeGroup matches.
  const copy = (
    <div className="titlebar-end flex shrink-0 items-center" aria-hidden style={{ visibility: 'hidden' }}>
      <EdgeGroupButtons />
    </div>
  )
  if (!slots.fold) return copy
  // Folds open and shut with the pane sliding in to its right (index.css,
  // .titlebar-fold, timed like the pane), so the buttons before it glide.
  return (
    <div className="titlebar-fold" style={{ maxWidth: room ? '240px' : '0px' }}>
      {copy}
    </div>
  )
}

/**
 * The window-edge group itself (Linux, pane headers as the title bar): drawn
 * once, over the top-right corner of the panes, where the header at the right
 * window edge keeps room for it (TitlebarEnd). Tasks and the details panel
 * are utility panes below the header bar (GNOME HIG), so the group stays put
 * whichever panes are open, and it is never handed from one pane to another.
 */
export function WindowEdgeGroup() {
  const panes = usePaneTitlebar()
  if (!panes) return null
  return (
    <div data-titlebar="pane" className="titlebar-end absolute right-0 top-0 z-40 flex h-16 items-center pr-2">
      <EdgeGroupButtons />
    </div>
  )
}

/**
 * The primary menu (☰, quick settings) in the header bar on Linux. The GNOME
 * HIG puts it above the sidebar list in a window that has one, so it ends the
 * header of the pane at the left window edge: the thread list or the board.
 */
export function TitlebarMenu() {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<MenuPosition>(null)
  const slots = useTitlebarSlots()
  const panes = usePaneTitlebar()
  if (!panes || !slots.start) return null
  return (
    <>
      <IconButton
        icon={HeaderMenuIcon}
        label={t('common.more')}
        active={!!menu}
        onClick={(event) => openUnder(event, setMenu)}
      />
      <TitleBarMenus menu={menu} setMenu={setMenu} />
    </>
  )
}

/**
 * A header-height title bar row for a pane that has no header of its own
 * (the empty conversation, the setup screen): a drag region holding the
 * window controls, and the primary menu and Tasks toggle unless `tools` is off.
 * Nothing unless the pane headers are the title bar.
 */
export function TitlebarStrip({ tools = true }: { tools?: boolean }) {
  const slots = useTitlebarSlots()
  const panes = usePaneTitlebar()
  if (!panes || (!slots.start && !slots.end && !slots.reserve)) return null
  return (
    <div data-titlebar="pane" className="flex h-16 shrink-0 items-center px-2">
      <WindowControls side="start" />
      <div className="flex-1" />
      {tools && <TitlebarMenu />}
      {tools ? <TitlebarEnd /> : <WindowControls side="end" />}
    </div>
  )
}

/** The quick-settings menu the title bar's ☰ (or a right-click on the strip) opens. */
function TitleBarMenus({ menu, setMenu }: MenuProps) {
  const { t } = useTranslation()
  const [boardDialog, setBoardDialog] = useState<BoardDialogState | null>(null)
  return (
    <>
      {menu && (
        <QuickSettingsMenu
          anchor={{ x: menu.x, y: menu.y, placement: 'down' }}
          onAddKanbanBoard={() => setBoardDialog({ mode: 'create', name: t('kanban.board.defaultName') })}
          onClose={() => setMenu(null)}
        />
      )}
      {/* Out of the title bar, which would make the dialog move the window. */}
      {boardDialog &&
        createPortal(
          <BoardDialog state={boardDialog} onChange={setBoardDialog} onClose={() => setBoardDialog(null)} />,
          document.body,
        )}
    </>
  )
}

// QuickSettingsMenu is w-60; line its right edge up with the button.
function openUnder(event: MouseEvent<HTMLElement>, setMenu: MenuProps['setMenu']) {
  const rect = event.currentTarget.getBoundingClientRect()
  setMenu({ x: rect.right - 240, y: rect.bottom })
}

function TitleBarTools({ menu, setMenu }: MenuProps) {
  const { t } = useTranslation()
  const windows = useValue(windowChrome$.platform) === 'windows'
  const tasksEnabled = useValue(settings$.tasksEnabled)
  const tasksPanelOpen = useValue(ui$.tasksPanelOpen)
  const button = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors cursor-pointer'
  const idle = 'text-sidenav-ink/60 hover:bg-sidenav-ink/10 hover:text-sidenav-ink'
  const pressed = 'bg-sidenav-ink/15 text-sidenav-ink'

  return (
    <div className={`flex items-center gap-1 ${windows ? 'mr-2' : ''}`}>
      {tasksEnabled && (
        // Hidden with the panel itself, which doesn't fit below 900px.
        <button
          type="button"
          className={`${button} ${tasksPanelOpen ? pressed : idle} max-[900px]:hidden`}
          onClick={toggleTasksPanel}
          title={t('tasks.title')}
          aria-label={t('tasks.title')}
          aria-pressed={tasksPanelOpen}
        >
          <SquareCheckBig size={15} />
        </button>
      )}
      <button
        type="button"
        className={`${button} ${menu ? pressed : idle}`}
        onClick={(event) => openUnder(event, setMenu)}
        title={t('common.more')}
        aria-label={t('common.more')}
      >
        <Menu size={15} />
      </button>
    </div>
  )
}

/** The Tasks toggle in the header bar, pressed while the panel is open (F9). */
function PaneTasksToggle() {
  const { t } = useTranslation()
  const tasksEnabled = useValue(settings$.tasksEnabled)
  const tasksPanelOpen = useValue(ui$.tasksPanelOpen)
  if (!tasksEnabled) return null
  return (
    // Hidden with the panel itself, which doesn't fit below 900px.
    <IconButton
      icon={HeaderTasksIcon}
      label={t('tasks.title')}
      active={tasksPanelOpen}
      aria-pressed={tasksPanelOpen}
      className="max-[900px]:hidden"
      onClick={toggleTasksPanel}
    />
  )
}
