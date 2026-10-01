import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Menu, SquareCheckBig } from 'lucide-react'
import { useValue } from '@legendapp/state/react'
import { useTranslation } from '../../lib/i18n'
import { isMac } from '../../lib/shortcuts'
import { windowChrome$ } from '../../lib/windowChrome'
import { settings$ } from '../../states/settings'
import { toggleTasksPanel } from '../../states/tasks'
import { ui$ } from '../../states/ui'
import { BoardDialog, type BoardDialogState } from '../sidenav/BoardDialog'
import { QuickSettingsMenu } from '../sidenav/QuickSettingsMenu'
import { WindowControls } from './WindowControls'

/**
 * Whether Meron draws its own title bar: always on macOS (the native one is
 * hidden, see main.go), and on Linux and Windows while the integrated title
 * bar is in effect. Elsewhere the system title bar stays and the side navigation keeps
 * the buttons the title bar would hold.
 */
export function useTitleBar(): boolean {
  const integrated = useValue(windowChrome$.integrated)
  return isMac || integrated
}

/**
 * The window's top row, in the side navigation's colors so the two read as
 * one frame. It moves the window ([data-titlebar] in index.css) and holds the
 * app-wide Tasks and quick-settings buttons, plus the window controls on Linux
 * and Windows.
 * On macOS it stays at the hidden title bar's height so the traffic lights,
 * which float over its left end, stay centred in it.
 */
export function TitleBar({ tools = true }: { tools?: boolean }) {
  const shown = useTitleBar()
  const windows = useValue(windowChrome$.platform) === 'windows'
  if (!shown) return null
  // macOS: the hidden title bar's height, clear of the traffic lights. Windows:
  // the caption's 32px, the caption buttons flush with the right edge.
  // Linux: room for GNOME's 34px window controls.
  const layout = isMac ? 'h-7 pr-2 pl-20' : windows ? 'h-8 pl-1.5' : 'h-10 px-1.5'
  return (
    <div data-titlebar className={`flex shrink-0 items-center bg-sidenav text-sidenav-ink ${layout}`}>
      <WindowControls side="start" />
      <div className="flex-1" />
      {tools && <TitleBarTools />}
      <WindowControls side="end" />
    </div>
  )
}

function TitleBarTools() {
  const { t } = useTranslation()
  const windows = useValue(windowChrome$.platform) === 'windows'
  const tasksEnabled = useValue(settings$.tasksEnabled)
  const tasksPanelOpen = useValue(ui$.tasksPanelOpen)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [boardDialog, setBoardDialog] = useState<BoardDialogState | null>(null)
  const compact = isMac || windows
  const button = `flex shrink-0 items-center justify-center rounded-lg transition-colors cursor-pointer ${
    compact ? 'h-6 w-6' : 'h-8 w-8'
  }`
  const idle = 'text-sidenav-ink/60 hover:bg-sidenav-ink/10 hover:text-sidenav-ink'
  const pressed = 'bg-sidenav-ink/15 text-sidenav-ink'
  const iconSize = compact ? 15 : 17

  return (
    <div className={`flex items-center gap-1 ${isMac ? '' : windows ? 'mr-2' : 'mr-1.5'}`}>
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
          <SquareCheckBig size={iconSize} />
        </button>
      )}
      <button
        type="button"
        className={`${button} ${menu ? pressed : idle}`}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          // QuickSettingsMenu is w-60; line its right edge up with the button.
          setMenu({ x: rect.right - 240, y: rect.bottom })
        }}
        title={t('common.more')}
        aria-label={t('common.more')}
      >
        <Menu size={iconSize} />
      </button>
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
    </div>
  )
}
