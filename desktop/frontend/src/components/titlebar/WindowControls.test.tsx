import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { windowChrome$ } from '../../lib/windowChrome'
import { settings$ } from '../../states/settings'
import { ui$ } from '../../states/ui'
import { TitleBar, TitlebarEnd, TitlebarMenu, TitlebarStrip } from './TitleBar'
import { TitlebarSlotsProvider, WindowControls, type TitlebarSlots } from './WindowControls'

const original = (window as any).go
let calls: string[] = []

beforeEach(() => {
  calls = []
  ;(window as any).go = { main: { App: { Invoke: async (command: string) => void calls.push(command) } } }
  windowChrome$.set({
    supported: true,
    integrated: true,
    wanted: true,
    platform: 'linux',
    layout: { start: [], end: ['minimize', 'maximize', 'close'] },
    doubleClick: 'toggle-maximize',
    maximised: false,
  })
})

afterEach(() => {
  cleanup()
  settings$.tasksEnabled.set(true)
  ;(window as any).go = original
})

const labels = (buttons: HTMLElement[]) => buttons.map((button) => button.getAttribute('aria-label'))

const BOTH = { start: true, end: true }

function inRow(children: ReactNode, slots: TitlebarSlots = BOTH) {
  return render(<TitlebarSlotsProvider value={slots}>{children}</TitlebarSlotsProvider>)
}

describe('WindowControls', () => {
  it("draws the side's buttons in the desktop's layout, and runs each command", () => {
    inRow(<WindowControls side="end" />)
    const buttons = screen.getAllByRole('button')
    expect(labels(buttons)).toEqual(['Minimize', 'Maximize', 'Close'])
    buttons.forEach((button) => fireEvent.click(button))
    expect(calls).toEqual(['window.minimise', 'window.toggleMaximise', 'window.close'])
  })

  it('draws nothing for a side the layout leaves empty', () => {
    inRow(<WindowControls side="start" />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it("draws nothing in a row that doesn't host that side", () => {
    inRow(<WindowControls side="end" />, { start: true, end: false })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('draws nothing with the system title bar', () => {
    windowChrome$.integrated.set(false)
    inRow(<WindowControls side="end" />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('offers restore while maximised', () => {
    windowChrome$.maximised.set(true)
    inRow(<WindowControls side="end" />)
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
  })

  it("draws Adwaita's glyphs on their circle, as GTK's own title bar does", () => {
    windowChrome$.layout.set({ start: [], end: ['maximize'] })
    const { container } = inRow(<WindowControls side="end" />)
    const glyph = () => container.querySelector('.window-control svg path')?.getAttribute('d')
    expect(container.querySelector('.window-control svg circle.window-control-circle')).not.toBeNull()
    // window-maximize-symbolic, then window-restore-symbolic once maximised.
    expect(glyph()).toBe('m3.99 3.99v8.01h8.01v-8.01zm2 2h4.01v4.01h-4.01z')
    act(() => windowChrome$.maximised.set(true))
    expect(glyph()).toBe('m4.99 4.99v6.01h6.01v-6.01zm2 2h2.01v2.01h-2.01z')
  })
})

describe('WindowControls on Windows', () => {
  it('draws the caption buttons, the close one marked for its red hover', () => {
    windowChrome$.platform.set('windows')
    inRow(<WindowControls side="end" />)
    const buttons = screen.getAllByRole('button')
    expect(labels(buttons)).toEqual(['Minimize', 'Maximize', 'Close'])
    expect(buttons.map((button) => button.className)).toEqual([
      'caption-button',
      'caption-button',
      'caption-button caption-button-close',
    ])
    buttons.forEach((button) => fireEvent.click(button))
    expect(calls).toEqual(['window.minimise', 'window.toggleMaximise', 'window.close'])
  })

  it('shows the restore glyph while maximised', () => {
    windowChrome$.platform.set('windows')
    windowChrome$.maximised.set(true)
    inRow(<WindowControls side="end" />)
    expect(screen.getByRole('button', { name: 'Restore' }).textContent).toBe('')
  })
})

describe('TitleBar (the strip, Windows)', () => {
  beforeEach(() => windowChrome$.platform.set('windows'))

  it('holds the app buttons between the two sides of window controls', () => {
    windowChrome$.layout.set({ start: ['close'], end: ['minimize'] })
    settings$.tasksEnabled.set(false)
    render(<TitleBar />)
    expect(labels(screen.getAllByRole('button'))).toEqual(['Close', 'More', 'Minimize'])
    act(() => settings$.tasksEnabled.set(true))
    expect(labels(screen.getAllByRole('button'))).toEqual(['Close', 'Tasks', 'More', 'Minimize'])
  })

  it('opens quick settings at the cursor when the title bar is right-clicked', () => {
    const { container } = render(<TitleBar />)
    const titleBar = container.querySelector('[data-titlebar]')!
    expect(fireEvent.contextMenu(titleBar, { clientX: 120, clientY: 20 })).toBe(false)
    const settings = screen.getByRole('button', { name: /Settings/ })
    const menu = settings.parentElement!
    expect(menu.style.left).toBe('120px')
    expect(menu.style.top).toBe('24px')
    expect(screen.getByRole('button', { name: 'Add kanban board' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /Settings/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('button', { name: /Settings/ })).toBeTruthy()
  })

  it('leaves the app buttons out on the setup screen', () => {
    render(<TitleBar tools={false} />)
    expect(labels(screen.getAllByRole('button'))).toEqual(['Minimize', 'Maximize', 'Close'])
  })

  it('is not drawn with the system title bar (off macOS)', () => {
    const { container } = render(<TitleBar />)
    expect(container.querySelector('[data-titlebar]')).not.toBeNull()
    act(() => windowChrome$.integrated.set(false))
    expect(container.querySelector('[data-titlebar]')).toBeNull()
  })

  it('is not drawn on Linux, where the pane headers are the title bar', () => {
    const { container } = render(<TitleBar />)
    act(() => windowChrome$.platform.set('linux'))
    expect(container.querySelector('[data-titlebar]')).toBeNull()
  })
})

describe('TitlebarEnd (the header bar at the right window edge, Linux)', () => {
  it('puts the Tasks toggle before the window controls, set apart by a divider', () => {
    const { container } = inRow(<TitlebarEnd />)
    expect(labels(screen.getAllByRole('button'))).toEqual(['Tasks', 'Minimize', 'Maximize', 'Close'])
    expect(container.querySelector('.window-controls')?.previousElementSibling?.className).toContain('w-px')
  })

  it('shows the Tasks toggle pressed while the panel is open', () => {
    act(() => ui$.tasksPanelOpen.set(true))
    inRow(<TitlebarEnd />)
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-pressed')).toBe('true')
    act(() => ui$.tasksPanelOpen.set(false))
  })

  it('leaves the Tasks toggle out when Tasks is turned off', () => {
    settings$.tasksEnabled.set(false)
    inRow(<TitlebarEnd />)
    expect(labels(screen.getAllByRole('button'))).toEqual(['Minimize', 'Maximize', 'Close'])
  })

  it('has no divider when the window buttons are on the other side', () => {
    windowChrome$.layout.set({ start: ['close'], end: [] })
    const { container } = inRow(<TitlebarEnd />)
    expect(labels(screen.getAllByRole('button'))).toEqual(['Tasks'])
    expect(container.querySelector('.w-px')).toBeNull()
  })

  it('keeps its exact space, invisible and out of reach, where it is only reserved', () => {
    const { container } = inRow(<TitlebarEnd />, { start: false, end: false, reserve: true })
    const group = container.querySelector<HTMLElement>('.titlebar-end')!
    expect(group.style.visibility).toBe('hidden')
    expect(group.getAttribute('aria-hidden')).toBe('true')
    // The same buttons as the real group, so the same width.
    expect(group.querySelectorAll('button')).toHaveLength(4)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it("draws nothing in a pane that isn't at the right window edge", () => {
    inRow(<TitlebarEnd />, { start: true, end: false })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('draws nothing with the system title bar', () => {
    windowChrome$.integrated.set(false)
    inRow(<TitlebarEnd />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('draws nothing on Windows, where the strip holds the app buttons', () => {
    windowChrome$.platform.set('windows')
    inRow(<TitlebarEnd />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('TitlebarMenu (the primary menu above the list, Linux)', () => {
  it('opens quick settings from the pane at the left window edge', () => {
    inRow(<TitlebarMenu />, { start: true, end: false })
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('button', { name: /Settings/ })).toBeTruthy()
  })

  it("draws nothing in a pane that isn't at the left window edge", () => {
    inRow(<TitlebarMenu />, { start: false, end: true })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('draws nothing with the system title bar, where the side navigation holds it', () => {
    windowChrome$.integrated.set(false)
    inRow(<TitlebarMenu />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('TitlebarStrip (a pane without a header, Linux)', () => {
  it('is a pane drag region holding the primary menu, the Tasks toggle and the window controls', () => {
    const { container } = inRow(<TitlebarStrip />)
    expect(container.querySelector('[data-titlebar="pane"]')).not.toBeNull()
    expect(labels(screen.getAllByRole('button'))).toEqual(['More', 'Tasks', 'Minimize', 'Maximize', 'Close'])
  })

  it('leaves the app buttons out on the setup screen', () => {
    inRow(<TitlebarStrip tools={false} />)
    expect(labels(screen.getAllByRole('button'))).toEqual(['Minimize', 'Maximize', 'Close'])
  })

  it('is not drawn in a pane hosting neither side', () => {
    const { container } = inRow(<TitlebarStrip />, { start: false, end: false })
    expect(container.querySelector('[data-titlebar]')).toBeNull()
  })
})
