import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { ConversationTabs } from './ConversationTabs'
import { openThreadTab } from '../../states/compose'
import { compose$ } from '../../states/composeState'
import { kanban$ } from '../../states/kanban'
import { ui$ } from '../../states/ui'
import { windowChrome$ } from '../../lib/windowChrome'
import type { Message } from '../../types'

const message = (over: Partial<Message> = {}): Message =>
  ({
    id: 'm1',
    account_id: 'acct',
    folder_id: 'INBOX',
    thread_id: 't-tab',
    from_name: 'A',
    from_addr: 'a@example.com',
    to: '',
    subject: 'Task mail',
    preview: '',
    body: '',
    date: 1,
    unread: false,
    starred: false,
    has_attachments: false,
    ...over,
  }) as Message

describe('ConversationTabs', () => {
  beforeEach(() => {
    compose$.tabs.set([])
    compose$.activeTab.set('')
    compose$.conversationThread.set('')
    ui$.selectedThread.set('')
    kanban$.activeBoardId.set('')
    kanban$.paneThreadId.set('')
  })
  afterEach(cleanup)

  it('is a 64px header-bar row under the GNOME header bar, and 40px elsewhere', () => {
    openThreadTab(message())
    const strip = (view: ReturnType<typeof render>) => view.container.querySelector('.no-scrollbar') as HTMLElement
    const chrome = (platform: string, integrated: boolean) =>
      windowChrome$.set({
        supported: integrated,
        integrated,
        wanted: integrated,
        platform,
        layout: { start: [], end: ['close'] },
        doubleClick: 'toggle-maximize',
        maximised: false,
      })
    chrome('linux', true)
    const gnome = render(<ConversationTabs />)
    // Matches the window's corner group, which is drawn 64px tall.
    expect(strip(gnome).className).toContain('h-16')
    gnome.unmount()
    for (const [platform, integrated] of [
      ['linux', false],
      ['windows', true],
      ['darwin', false],
    ] as const) {
      chrome(platform, integrated)
      const view = render(<ConversationTabs />)
      expect(strip(view).className).toContain('h-10')
      view.unmount()
    }
    chrome('linux', false)
  })

  it('offers the Current tab while a conversation sits behind the tabs', () => {
    ui$.selectedThread.set('t-current')
    openThreadTab(message())
    const view = render(<ConversationTabs />)
    expect(view.queryByTitle('Current conversation')).not.toBeNull()
  })

  it('hides the Current tab when no conversation is open behind the tabs', () => {
    // A task's mail opened with an empty pane: there is nothing to go back to,
    // and in kanban view the Current tab would close the pane outright.
    openThreadTab(message())
    const view = render(<ConversationTabs />)
    expect(view.queryByTitle('Current conversation')).toBeNull()
    expect(view.queryByTitle('Task mail')).not.toBeNull()
  })

  it('follows the kanban pane rather than the remembered thread on a board', () => {
    kanban$.activeBoardId.set('board-1')
    ui$.selectedThread.set('t-current')
    openThreadTab(message())
    const view = render(<ConversationTabs />)
    expect(view.queryByTitle('Current conversation')).toBeNull()

    act(() => kanban$.paneThreadId.set('t-card'))
    expect(view.queryByTitle('Current conversation')).not.toBeNull()
  })

  it('closes the Current conversation along with the tabs from its menu', () => {
    ui$.selectedThread.set('t-current')
    openThreadTab(message())
    openThreadTab(message({ thread_id: 't-other', subject: 'Other mail' }))
    const view = render(<ConversationTabs />)

    fireEvent.contextMenu(view.getByTitle('Current conversation'))
    // Current sits first: nothing lies to its left.
    expect((view.getByText('Close tabs to the left').closest('button') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(view.getByText('Close all tabs'))

    expect(compose$.tabs.get()).toHaveLength(0)
    expect(compose$.conversationThread.get()).toBe('')
    expect(ui$.selectedThread.get()).toBe('')
  })

  it("closes only the tabs from Current's close-others entry", () => {
    ui$.selectedThread.set('t-current')
    openThreadTab(message())
    const view = render(<ConversationTabs />)

    fireEvent.contextMenu(view.getByTitle('Current conversation'))
    fireEvent.click(view.getByText('Close other tabs'))

    expect(compose$.tabs.get()).toHaveLength(0)
    expect(compose$.activeTab.get()).toBe('')
    expect(ui$.selectedThread.get()).toBe('t-current')
  })
})
