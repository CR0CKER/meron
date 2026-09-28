import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { KanbanConversationPane, PANE_ANIMATION_MS } from './KanbanConversationPane'

const pane = (open: boolean) => (
  <KanbanConversationPane open={open} widthPercent={40} resizeTitle="Resize" onResizeStart={() => {}}>
    <p>conversation</p>
  </KanbanConversationPane>
)

describe('KanbanConversationPane', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    ;(globalThis as any).matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
  })

  afterEach(() => {
    cleanup()
    jest.useRealTimers()
  })

  const root = (view: ReturnType<typeof render>) =>
    view.container.querySelector('[data-pane-phase]') as HTMLElement | null

  it('slides open, then drops the animation so drag-resizing stays immediate', () => {
    const view = render(pane(false))
    expect(root(view)).toBeNull()

    view.rerender(pane(true))
    expect(root(view)?.dataset.panePhase).toBe('entering')
    expect(root(view)?.className).toContain('animate-pane-open')
    expect(view.queryByText('conversation')).not.toBeNull()

    act(() => {
      jest.advanceTimersByTime(PANE_ANIMATION_MS)
    })
    expect(root(view)?.dataset.panePhase).toBe('open')
    expect(root(view)?.className).not.toContain('animate-pane')
  })

  it('collapses as an empty pane, then unmounts', () => {
    const view = render(pane(true))
    view.rerender(pane(false))
    expect(root(view)?.dataset.panePhase).toBe('exiting')
    expect(root(view)?.className).toContain('animate-pane-close')
    // The closed conversation has already been cleared from state; the pane
    // collapses without it rather than sliding out an empty-state message.
    expect(view.queryByText('conversation')).toBeNull()

    act(() => {
      jest.advanceTimersByTime(PANE_ANIMATION_MS)
    })
    expect(root(view)).toBeNull()
  })
})
