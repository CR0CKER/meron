import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { accounts$ } from '../../states/accounts'
import '../../states/mail'
import { windowChrome$ } from '../../lib/windowChrome'
import { KanbanView } from './KanbanView'

const original = (window as any).go

function chrome(platform: string, integrated: boolean) {
  windowChrome$.set({
    supported: integrated,
    integrated,
    wanted: integrated,
    platform,
    layout: { start: [], end: ['close'] },
    doubleClick: 'toggle-maximize',
    maximised: false,
  })
}

beforeEach(() => {
  ;(window as any).go = { main: { App: { Invoke: async () => ({}) } } }
  // With no account the view is an empty state without a header.
  accounts$.set([{ id: 'a@example.com', email: 'a@example.com', name: 'A' } as any])
})

afterEach(() => {
  cleanup()
  accounts$.set([])
  ;(window as any).go = original
})

const header = (view: ReturnType<typeof render>) =>
  view.container.querySelector('[data-titlebar="pane"]') as HTMLElement

describe('KanbanView header', () => {
  // In the window's rounded top-right corner under the GNOME header bar,
  // WebKit didn't always clip the blurred (separately composited) header
  // after a maximise and restore, leaving that corner square.
  it('has no backdrop blur under the GNOME header bar', () => {
    chrome('linux', true)
    expect(header(render(<KanbanView boardId="b1" />)).className).not.toContain('backdrop-blur')
  })

  it('keeps its blur elsewhere, as in 0.4.0', () => {
    for (const [platform, integrated] of [
      ['darwin', false],
      ['windows', true],
      ['linux', false],
    ] as const) {
      chrome(platform, integrated)
      const view = render(<KanbanView boardId="b1" />)
      expect(header(view).className).toContain('backdrop-blur-md')
      view.unmount()
    }
  })
})
