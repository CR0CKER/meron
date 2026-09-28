import { useEffect, useRef, useState } from 'react'
import { MessageSquare, SquarePen, X } from 'lucide-react'
import { useValue } from '@legendapp/state/react'
import { useTranslation } from '../../lib/i18n'
import { closeMessageTab, activateConversationTab } from '../../states/compose'
import { compose$ } from '../../states/composeState'
import { kanban$ } from '../../states/kanban'
import { ui$ } from '../../states/ui'

// A wheel line or page in pixels, for devices that report deltas in those
// units (deltaMode 1 and 2) rather than pixels.
const WHEEL_LINE_PX = 40

// Scrolls the strip, and only the strip, just enough to show the tab.
function revealTab(strip: HTMLElement, tabId: string) {
  const tab = strip.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tabId)}"]`)
  if (!tab) return
  const stripRect = strip.getBoundingClientRect()
  const tabRect = tab.getBoundingClientRect()
  if (tabRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - tabRect.left
  else if (tabRect.right > stripRect.right) strip.scrollLeft += tabRect.right - stripRect.right
}

// The tab strip above the conversation: the "Current" tab (when a conversation
// is open behind the tabs) plus open thread, reader and compose tabs. Renders
// nothing when no tabs are open.
export function ConversationTabs() {
  const { t } = useTranslation()
  const tabs = useValue(compose$.tabs)
  const activeTab = useValue(compose$.activeTab)
  const conversationThread = useValue(compose$.conversationThread)
  const activeBoardId = useValue(kanban$.activeBoardId)
  const paneThreadId = useValue(kanban$.paneThreadId)
  // The Current tab returns to the conversation the pane was showing before a
  // tab took over it. With no such conversation there is nothing to return to:
  // it would blank the pane, and in kanban view — where the pane only exists
  // while a card or a tab is open — close it outright. So it is only offered
  // once there is a conversation behind the tabs. Kanban owns its open
  // conversation through paneThreadId; elsewhere it's the remembered thread.
  const hasCurrentConversation = activeBoardId ? !!paneThreadId : !!conversationThread
  const stripRef = useRef<HTMLDivElement>(null)

  // Keep the active tab visible, e.g. a newly opened one past the strip's
  // right edge. Size changes re-run this below.
  useEffect(() => {
    if (stripRef.current) revealTab(stripRef.current, activeTab)
  }, [activeTab, tabs.length])

  // The strip hides its scrollbar (it would sit on the active tab's
  // underline), so a vertical wheel scrolls it sideways instead, and a fade on
  // each edge with tabs past it hints there is more. The wheel listener is
  // native: React's onWheel is passive and can't stop the page scrolling.
  const hasTabs = tabs.length > 0
  const [overflow, setOverflow] = useState({ left: false, right: false })
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const updateOverflow = () => {
      const left = strip.scrollLeft > 1
      const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1
      setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
    }
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      if (strip.scrollWidth <= strip.clientWidth) return
      event.preventDefault()
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? strip.clientWidth
          : event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? WHEEL_LINE_PX
            : 1
      strip.scrollLeft += event.deltaY * unit
    }
    updateOverflow()
    strip.addEventListener('wheel', onWheel, { passive: false })
    strip.addEventListener('scroll', updateOverflow, { passive: true })
    // Watch the tabs too: opening or closing one, or a compose tab's subject
    // growing, changes the scroll width without resizing the strip. Either
    // kind of change can push the active tab out of view.
    const onResize = () => {
      revealTab(strip, compose$.activeTab.peek())
      updateOverflow()
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize)
    observer?.observe(strip)
    for (const child of strip.children) observer?.observe(child)
    return () => {
      strip.removeEventListener('wheel', onWheel)
      strip.removeEventListener('scroll', updateOverflow)
      observer?.disconnect()
    }
  }, [hasTabs, tabs.length, hasCurrentConversation])

  if (!hasTabs) return null

  return (
    <div className="relative shrink-0 border-b border-border bg-header">
      {overflow.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-linear-to-r from-header to-transparent" />
      )}
      {overflow.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-linear-to-l from-header to-transparent" />
      )}
      <div ref={stripRef} className="flex h-10 items-stretch gap-1 no-scrollbar overflow-x-auto px-2 select-none">
        {hasCurrentConversation && (
          <button
            data-tab-id=""
            onClick={() => activateConversationTab()}
            className={`flex items-center gap-1.5 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === '' ? 'border-accent text-accent' : 'border-transparent text-secondary hover:text-primary'
            }`}
            title={t('chat.currentConversation')}
          >
            <MessageSquare size={13} />
            {t('chat.current')}
          </button>
        )}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            onClick={() => {
              // Activate the tab before retargeting selectedThread so the Current
              // tab's remembered thread (conversationThread) isn't overwritten.
              compose$.activeTab.set(tab.id)
              if (tab.kind === 'thread') ui$.selectedThread.set(tab.threadId)
            }}
            className={`group flex max-w-[200px] cursor-pointer items-center gap-1.5 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
            title={tab.subject}
          >
            {tab.kind === 'thread' && <MessageSquare size={12} className="shrink-0" />}
            {tab.kind === 'compose' && <SquarePen size={12} className="shrink-0" />}
            <span className="truncate">{tab.subject}</span>
            <button
              onClick={(event) => {
                event.stopPropagation()
                void closeMessageTab(tab.id)
              }}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-active hover:text-primary"
              title={t('chat.closeTab')}
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
