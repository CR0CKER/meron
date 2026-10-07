import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createRef } from 'react'
import type { ReactElement } from 'react'
// Initialize this side of the mail/compose cycle before ConversationMessageList
// pulls both modules in through its message actions and mail paging imports.
import '../../states/compose'
import { settings$ } from '../../states/settings'
import type { Message } from '../../types'
import { ConversationMessageList } from './ConversationMessageList'
import { ConversationScrollContext, type ConversationScroll } from './useConversationScroll'

function withScroll(overrides: Partial<ConversationScroll>, list: ReactElement) {
  const scroll: ConversationScroll = {
    scrollRef: createRef<HTMLDivElement>(),
    messagesWrapperRef: createRef<HTMLDivElement>(),
    bottomAnchorRef: createRef<HTMLDivElement>(),
    handleConversationScroll: () => undefined,
    maybeMarkRead: () => undefined,
    setScrollTop: () => undefined,
    scrollMessageToTop: () => undefined,
    releasePinForUserScroll: () => undefined,
    ...overrides,
  }
  return <ConversationScrollContext value={scroll}>{list}</ConversationScrollContext>
}

function message(id: string, body: string): Message {
  return {
    id,
    account_id: 'account-1',
    folder_id: 'inbox',
    thread_id: 'thread-1',
    from_name: 'Sender',
    from_addr: 'sender@example.com',
    to: 'me@example.com',
    subject: 'Subject',
    preview: body,
    body,
    date: 0,
    unread: false,
    starred: false,
    has_attachments: false,
  }
}

afterEach(() => {
  cleanup()
  settings$.conversationLayout.set('chat')
})

describe('ConversationMessageList direct jumps', () => {
  it('keeps an older jumped-to message expanded after its highlight ends', () => {
    settings$.conversationLayout.set('traditional')
    const messages = [message('older', 'Older body'), message('newer', 'Newer body')]
    const scroll = {
      scrollRef: createRef<HTMLDivElement>(),
      messagesWrapperRef: createRef<HTMLDivElement>(),
      bottomAnchorRef: createRef<HTMLDivElement>(),
    }
    const commonProps = {
      messages,
      showThreadLoading: false,
      showThreadError: false,
      onRetryThreadLoad: () => undefined,
      messagesCursor: '',
      messagesLoadingMore: false,
      activeThreadId: 'thread-1',
      searchMatches: [],
      activeSearchId: '',
      galleryOffsets: new Map<string, number>(),
      wallpaperClassName: '',
    }

    const view = render(withScroll(scroll, <ConversationMessageList {...commonProps} jumpMessageId="" />))
    const older = view.container.querySelector<HTMLElement>('[data-message-id="older"]')!
    expect(older.querySelector('[title="Expand message"]')).not.toBeNull()

    view.rerender(withScroll(scroll, <ConversationMessageList {...commonProps} jumpMessageId="older" />))
    expect(older.querySelector('[title="Collapse message"]')).not.toBeNull()

    view.rerender(withScroll(scroll, <ConversationMessageList {...commonProps} jumpMessageId="" />))
    expect(older.querySelector('[title="Collapse message"]')).not.toBeNull()
  })

  it('scrolls an expanded message only after its full row has committed', () => {
    settings$.conversationLayout.set('traditional')
    const messages = [message('older', 'Older body'), message('newer', 'Newer body')]
    let expandedWhenScrolled = false
    const view = render(
      withScroll(
        {
          scrollMessageToTop: (messageId) => {
            expandedWhenScrolled =
              messageId === 'older' &&
              view.container.querySelector('[data-message-id="older"] [title="Collapse message"]') !== null
          },
        },
        <ConversationMessageList
          messages={messages}
          showThreadLoading={false}
          showThreadError={false}
          onRetryThreadLoad={() => undefined}
          messagesCursor=""
          messagesLoadingMore={false}
          activeThreadId="thread-1"
          searchMatches={[]}
          activeSearchId=""
          jumpMessageId=""
          galleryOffsets={new Map<string, number>()}
          wallpaperClassName=""
        />,
      ),
    )

    fireEvent.click(view.container.querySelector('[data-message-id="older"] [title="Expand message"]')!)

    expect(expandedWhenScrolled).toBe(true)
  })

  it('reports wheel input separately from the resulting scroll event', () => {
    let scrollIntents = 0
    let scrollEvents = 0
    const view = render(
      withScroll(
        {
          handleConversationScroll: () => scrollEvents++,
          releasePinForUserScroll: () => scrollIntents++,
        },
        <ConversationMessageList
          messages={[message('newer', 'Newer body')]}
          showThreadLoading={false}
          showThreadError={false}
          onRetryThreadLoad={() => undefined}
          messagesCursor=""
          messagesLoadingMore={false}
          activeThreadId="thread-1"
          searchMatches={[]}
          activeSearchId=""
          jumpMessageId=""
          galleryOffsets={new Map<string, number>()}
          wallpaperClassName=""
        />,
      ),
    )

    const scroller = view.container.querySelector('.message-scroll')!
    fireEvent.scroll(scroller)
    expect(scrollIntents).toBe(0)
    expect(scrollEvents).toBe(1)

    fireEvent.wheel(scroller)
    expect(scrollIntents).toBe(1)
  })
})
