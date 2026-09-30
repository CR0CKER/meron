import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { windowChrome$ } from '../../lib/windowChrome'
import { TitlebarSlotsProvider, TitlebarStrip, WindowControls } from './WindowControls'

const original = (window as any).go
let calls: string[] = []

beforeEach(() => {
  calls = []
  ;(window as any).go = { main: { App: { Invoke: async (command: string) => void calls.push(command) } } }
  windowChrome$.set({
    supported: true,
    integrated: true,
    layout: { start: [], end: ['minimize', 'maximize', 'close'] },
    doubleClick: 'toggle-maximize',
    maximised: false,
  })
})

afterEach(() => {
  cleanup()
  ;(window as any).go = original
})

function header(slots: { start: boolean; end: boolean }) {
  return render(
    <TitlebarSlotsProvider value={slots}>
      <header data-titlebar>
        <WindowControls side="start" />
        <WindowControls side="end" />
      </header>
    </TitlebarSlotsProvider>,
  )
}

describe('WindowControls', () => {
  it('draws the layout on the side this row hosts, and runs each command', () => {
    header({ start: false, end: true })
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Minimize', 'Maximize', 'Close'])
    buttons.forEach((button) => fireEvent.click(button))
    expect(calls).toEqual(['window.minimise', 'window.toggleMaximise', 'window.close'])
  })

  it('draws nothing in a row that does not host the side', () => {
    header({ start: true, end: false })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('draws nothing with the system title bar', () => {
    windowChrome$.integrated.set(false)
    header({ start: true, end: true })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('offers restore while maximised', () => {
    windowChrome$.maximised.set(true)
    header({ start: false, end: true })
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
  })

  it('puts start buttons in the start slot', () => {
    windowChrome$.layout.set({ start: ['close'], end: [] })
    header({ start: true, end: false })
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Close'])
  })
})

describe('TitlebarStrip', () => {
  it('is a drag region only with the integrated title bar and a hosted side', () => {
    const { container, rerender } = render(
      <TitlebarSlotsProvider value={{ start: false, end: true }}>
        <TitlebarStrip />
      </TitlebarSlotsProvider>,
    )
    expect(container.querySelector('[data-titlebar]')).not.toBeNull()
    act(() => windowChrome$.integrated.set(false))
    rerender(
      <TitlebarSlotsProvider value={{ start: false, end: true }}>
        <TitlebarStrip />
      </TitlebarSlotsProvider>,
    )
    expect(container.querySelector('[data-titlebar]')).toBeNull()
  })
})
