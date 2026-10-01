import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, render, waitFor } from '@testing-library/react'
import { Menu } from 'lucide-react'
import { windowChrome$ } from '../../lib/windowChrome'
import { nativeIcons$ } from '../../lib/nativeIcons'
import { headerIcon } from './headerIcons'

const original = (window as any).go
let asked: string[] = []
let theme: Record<string, string> = {}

beforeEach(() => {
  asked = []
  theme = { 'open-menu-symbolic': '<svg viewBox="0 0 16 16"><path d="m1 2h14v2h-14z"/></svg>' }
  nativeIcons$.set({})
  ;(window as any).go = {
    main: {
      App: {
        Invoke: async (command: string, payload: { name: string }) => {
          if (command !== 'icon.symbolic') return {}
          asked.push(payload.name)
          return { svg: theme[payload.name] ?? '' }
        },
      },
    },
  }
  windowChrome$.set({
    supported: true,
    integrated: true,
    wanted: true,
    platform: 'linux',
    layout: { start: [], end: ['close'] },
    doubleClick: 'toggle-maximize',
    maximised: false,
  })
})

afterEach(() => {
  cleanup()
  ;(window as any).go = original
})

describe('headerIcon', () => {
  it("draws the desktop theme's symbolic icon as a mask while the pane headers are the title bar", async () => {
    const MenuIcon = headerIcon('open-menu-symbolic', Menu)
    const { container } = render(<MenuIcon size={18} />)
    await waitFor(() => expect(container.querySelector('.native-icon')).not.toBeNull())
    const icon = container.querySelector<HTMLElement>('.native-icon')!
    expect(icon.getAttribute('data-icon')).toBe('open-menu-symbolic')
    expect(icon.style.maskImage).toContain('data:image/svg+xml,')
    expect(container.querySelector('svg.lucide')).toBeNull()
    expect(asked).toEqual(['open-menu-symbolic'])
  })

  it('keeps the lucide icon when the theme has no such icon', async () => {
    const MissingIcon = headerIcon('no-such-thing-symbolic', Menu)
    const { container } = render(<MissingIcon />)
    await waitFor(() => expect(asked).toEqual(['no-such-thing-symbolic']))
    expect(container.querySelector('svg.lucide')).not.toBeNull()
    expect(container.querySelector('.native-icon')).toBeNull()
  })

  it('never asks the desktop with the system title bar, or on Windows', async () => {
    const MenuIcon = headerIcon('open-menu-symbolic', Menu)
    windowChrome$.integrated.set(false)
    const first = render(<MenuIcon />)
    expect(first.container.querySelector('svg.lucide')).not.toBeNull()
    first.unmount()
    windowChrome$.integrated.set(true)
    windowChrome$.platform.set('windows')
    const { container } = render(<MenuIcon />)
    expect(container.querySelector('svg.lucide')).not.toBeNull()
    expect(asked).toEqual([])
  })

  it('asks the desktop once per icon, however many buttons use it', async () => {
    const MenuIcon = headerIcon('open-menu-symbolic', Menu)
    const { container } = render(
      <>
        <MenuIcon />
        <MenuIcon />
      </>,
    )
    await waitFor(() => expect(container.querySelectorAll('.native-icon')).toHaveLength(2))
    expect(asked).toEqual(['open-menu-symbolic'])
  })
})
