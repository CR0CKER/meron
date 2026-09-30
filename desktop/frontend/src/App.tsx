import { useRef } from 'react'
import { useValue } from '@legendapp/state/react'
import { useTranslation } from './lib/i18n'
import { ui$ } from './states/ui'
import { mail$ } from './states/mail'
import { compose$ } from './states/composeState'
import { accounts$ } from './states/accounts'
import { kanban$ } from './states/kanban'
import { settings$ } from './states/settings'
import { startKanbanResize, startThreadListResize } from './lib/paneResize'
import { useAppEffects } from './useAppEffects'
import { SideNav } from './components/sidenav/SideNav'
import { ThreadList } from './components/threads/ThreadList'
import { KanbanView } from './components/kanban/KanbanView'
import { KanbanConversationPane } from './components/kanban/KanbanConversationPane'
import { TasksPanel } from './components/tasks/TasksPanel'
import { MessagePane } from './components/chat/MessagePane'
import { AboutDialog } from './components/dialog/AboutDialog'
import { ChangelogDialog } from './components/dialog/ChangelogDialog'
import { CommandPalette } from './components/palette/CommandPalette'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppHotkeys } from './components/dialog/AppHotkeys'
import { ShortcutsDialog } from './components/dialog/ShortcutsDialog'
import { AppToast } from './components/toast/AppToast'
import { McpApprovalDialog } from './components/dialog/McpApprovalDialog'
import { AppConfirm } from './components/dialog/AppConfirm'
import { CertificateTrustDialog } from './components/dialog/CertificateTrustDialog'
import { MacTitleBar } from './components/titlebar/MacTitleBar'
import { TitlebarSlotsProvider, TitlebarStrip } from './components/titlebar/WindowControls'
import { ConnectivityBanner } from './components/banner/ConnectivityBanner'
import { UpdateBanner } from './components/banner/UpdateBanner'
import { SetupScreen } from './components/setup/SetupScreen'
import { AccountDialog } from './components/dialog/AccountDialog'
import { SettingsDialog } from './components/dialog/SettingsDialog'
import { AddFeedDialog } from './components/dialog/AddFeedDialog'
import { FeedEditDialog } from './components/dialog/FeedEditDialog'

export default function App() {
  const { t } = useTranslation()
  const mainRef = useRef<HTMLElement | null>(null)
  const system = useValue(ui$.system)
  const accounts = useValue(accounts$)
  const activeBoardId = useValue(kanban$.activeBoardId)
  const tasksPanelOpen = useValue(ui$.tasksPanelOpen)
  const activeTaskList = useValue(ui$.activeTaskList)
  const composeTabs = useValue(compose$.tabs)
  const activeComposeTab = useValue(compose$.activeTab)
  const threadListWidth = useValue(settings$.threadListWidth)
  const kanbanPaneThreadId = useValue(kanban$.paneThreadId)
  const kanbanPaneWidth = useValue(settings$.kanbanPaneWidth)
  const setupOpen = useValue(ui$.setupOpen)
  const settingsOpen = useValue(ui$.settingsOpen)
  const addFeedAccount = useValue(ui$.addFeedAccount)
  const editFeed = useValue(ui$.editFeed)

  useAppEffects()

  const showKanbanMessagePane = !!kanbanPaneThreadId || composeTabs.some((tab) => tab.id === activeComposeTab)
  const showTasksPanel = tasksPanelOpen && !!activeTaskList
  // With the integrated title bar, the window controls go in the top row of
  // the pane at each window edge: the first content pane on the left (the side
  // navigation is too narrow), the rightmost pane on the right.
  const listSlots = { start: true, end: !!activeBoardId && !showKanbanMessagePane && !showTasksPanel }
  const conversationSlots = { start: false, end: !showTasksPanel }

  if (system && accounts.length === 0) {
    return (
      <div className="flex h-full w-full flex-col bg-app text-primary">
        <MacTitleBar />
        <TitlebarSlotsProvider value={{ start: true, end: true }}>
          <TitlebarStrip />
        </TitlebarSlotsProvider>
        <div className="min-h-0 flex-1">
          <SetupScreen />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-app text-primary">
      <MacTitleBar />
      <ConnectivityBanner />
      <UpdateBanner />
      <main ref={mainRef} className="flex min-h-0 w-full flex-1 overflow-hidden">
        <ErrorBoundary label="side navigation">
          <SideNav />
        </ErrorBoundary>
        <ErrorBoundary label="thread list">
          <TitlebarSlotsProvider value={listSlots}>
            {activeBoardId ? (
              <KanbanView boardId={activeBoardId} />
            ) : (
              <ThreadList width={threadListWidth} onResizeStart={startThreadListResize} />
            )}
          </TitlebarSlotsProvider>
        </ErrorBoundary>
        {!activeBoardId ? (
          <ErrorBoundary label="conversation">
            <TitlebarSlotsProvider value={conversationSlots}>
              <MessagePane />
            </TitlebarSlotsProvider>
          </ErrorBoundary>
        ) : (
          <KanbanConversationPane
            open={showKanbanMessagePane}
            widthPercent={kanbanPaneWidth}
            resizeTitle={t('layout.resizeConversation')}
            onResizeStart={(event) => startKanbanResize(event, mainRef.current)}
          >
            <ErrorBoundary label="conversation">
              <TitlebarSlotsProvider value={conversationSlots}>
                <MessagePane />
              </TitlebarSlotsProvider>
            </ErrorBoundary>
          </KanbanConversationPane>
        )}

        {/* Tasks is a panel, not a view: it sits to the right of whatever is
          open so a list can be worked against the thread list beside it. */}
        {showTasksPanel && activeTaskList ? (
          <ErrorBoundary label="tasks">
            <TitlebarSlotsProvider value={{ start: false, end: true }}>
              <TasksPanel listId={activeTaskList} />
            </TitlebarSlotsProvider>
          </ErrorBoundary>
        ) : null}

        <AppHotkeys />
        <CommandPalette />
        <ShortcutsDialog />
        <AboutDialog />
        <ChangelogDialog />

        {/* Settings first so the add-account dialog (setupOpen), opened from within
          Settings, layers on top and returns here when closed. */}
        {settingsOpen && <SettingsDialog />}
        {setupOpen && <AccountDialog />}
        {addFeedAccount && <AddFeedDialog />}
        {editFeed && <FeedEditDialog />}

        <AppToast />
        <AppConfirm />
        <McpApprovalDialog />
        <CertificateTrustDialog />
      </main>
    </div>
  )
}
