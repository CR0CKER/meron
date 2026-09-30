import { afterEach, describe, expect, it } from 'bun:test'
import { doubleClickCommand, loadWindowChrome, parseDecorationLayout, windowChrome$ } from './windowChrome'

const original = (window as any).go

afterEach(() => {
  ;(window as any).go = original
  document.documentElement.classList.remove('titlebar-integrated')
})

describe('parseDecorationLayout', () => {
  it('splits the buttons at the colon', () => {
    expect(parseDecorationLayout('appmenu:minimize,maximize,close')).toEqual({
      start: [],
      end: ['minimize', 'maximize', 'close'],
    })
    expect(parseDecorationLayout('close,minimize:')).toEqual({ start: ['close', 'minimize'], end: [] })
  })

  it('drops entries that are not window buttons, and repeats', () => {
    expect(parseDecorationLayout('menu:close')).toEqual({ start: [], end: ['close'] })
    expect(parseDecorationLayout('icon,close:close, maximize ,spacer')).toEqual({
      start: ['close'],
      end: ['maximize'],
    })
  })

  it('reads a layout without a colon as the right side, and an empty one as no buttons', () => {
    expect(parseDecorationLayout('close')).toEqual({ start: [], end: ['close'] })
    expect(parseDecorationLayout('')).toEqual({ start: [], end: [] })
  })
})

describe('doubleClickCommand', () => {
  it('maps GNOME double-click actions Wails can perform', () => {
    expect(doubleClickCommand('toggle-maximize')).toBe('toggleMaximise')
    expect(doubleClickCommand('minimize')).toBe('minimise')
    expect(doubleClickCommand('none')).toBeNull()
    expect(doubleClickCommand('menu')).toBeNull()
  })
})

describe('loadWindowChrome', () => {
  it('applies the reply and marks the document', async () => {
    ;(window as any).go = {
      main: {
        App: {
          Invoke: async () => ({
            supported: true,
            integrated: true,
            layout: 'close:minimize',
            doubleClick: 'minimize',
          }),
        },
      },
    }
    await loadWindowChrome()
    expect(windowChrome$.integrated.peek()).toBe(true)
    expect(windowChrome$.layout.peek()).toEqual({ start: ['close'], end: ['minimize'] })
    expect(windowChrome$.doubleClick.peek()).toBe('minimize')
    expect(document.documentElement.classList.contains('titlebar-integrated')).toBe(true)
  })
})
