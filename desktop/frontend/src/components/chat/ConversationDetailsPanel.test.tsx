import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
// Loads the state modules in the order the app does, so a cycle between
// them initialises cleanly (as in MessageBubble.test.tsx).
import '../../states/accounts'
import '../../states/mail'
import { windowChrome$ } from '../../lib/windowChrome'
import { ConversationDetailsPanel } from './ConversationDetailsPanel'

function platform(name: string, integrated: boolean) {
  windowChrome$.set({
    supported: integrated,
    integrated,
    wanted: integrated,
    platform: name,
    layout: { start: [], end: ['close'] },
    doubleClick: 'toggle-maximize',
    maximised: false,
  })
}

const panel = (onClose = () => {}) => (
  <ConversationDetailsPanel
    media={[]}
    files={[]}
    participants={[]}
    scopeTitle="Subject"
    loading={false}
    onOpenImage={() => {}}
    onShowInConversation={() => {}}
    onComposeTo={() => {}}
    onViewMessagesWith={() => {}}
    onClose={onClose}
  />
)

afterEach(() => cleanup())

describe('ConversationDetailsPanel header', () => {
  // As in 0.4.0 wherever the pane headers aren't the title bar.
  for (const [name, integrated] of [
    ['darwin', false],
    ['windows', true],
    ['linux', false],
  ] as const) {
    it(`keeps its own close button on ${name}${integrated ? ' (integrated title bar)' : ''}`, () => {
      platform(name, integrated)
      const { container } = render(panel())
      expect(screen.getByRole('button', { name: 'Close (Esc)' })).toBeTruthy()
      expect(container.querySelector('[data-titlebar]')).toBeNull()
    })
  }

  it('drops it under the GNOME header bar, whose details toggle closes it', () => {
    platform('linux', true)
    const { container } = render(panel())
    expect(screen.queryByRole('button', { name: 'Close (Esc)' })).toBeNull()
    expect(container.querySelector('[data-titlebar="pane"]')).not.toBeNull()
  })
})
