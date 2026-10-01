import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { windowChrome$ } from '../../lib/windowChrome'
import { tasks$ } from '../../states/tasks'
import { TasksPanel } from './TasksPanel'

const original = (window as any).go

function platform(name: string, integrated: boolean) {
  windowChrome$.set({
    supported: integrated,
    integrated,
    wanted: integrated,
    platform: name,
    layout: { start: [], end: ['minimize', 'maximize', 'close'] },
    doubleClick: 'toggle-maximize',
    maximised: false,
  })
}

beforeEach(() => {
  ;(window as any).go = { main: { App: { Invoke: async () => ({ tasks: [] }) } } }
  tasks$.lists.set([{ id: 'l1', title: 'My Tasks' } as any])
  tasks$.items.set([])
})

afterEach(() => {
  cleanup()
  ;(window as any).go = original
})

const labels = () => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.title)

describe('TasksPanel header', () => {
  // macOS, Windows, and Linux with the system title bar look as they did in
  // 0.4.0: the panel's own header, with its actions and a close button.
  for (const [name, integrated] of [
    ['darwin', false],
    ['windows', true],
    ['windows', false],
    ['linux', false],
  ] as const) {
    it(`keeps its own header with actions and a close button on ${name}${integrated ? ' (integrated title bar)' : ''}`, () => {
      platform(name, integrated)
      const { container } = render(<TasksPanel listId="l1" />)
      expect(labels()).toEqual(['My Tasks', 'More actions', 'Close'])
      expect(container.querySelector('header')?.className).toContain('h-12')
      expect(container.querySelector('[data-titlebar]')).toBeNull()
    })
  }

  it('sits under the GNOME header bar with the integrated title bar on Linux', () => {
    platform('linux', true)
    const { container } = render(<TasksPanel listId="l1" />)
    // The header bar's Tasks toggle closes it, and its actions are in the list menu.
    expect(labels()).toEqual(['My Tasks'])
    expect(container.querySelector('[data-titlebar="pane"]')).not.toBeNull()
  })
})
