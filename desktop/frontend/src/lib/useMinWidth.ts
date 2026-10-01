import { useSyncExternalStore } from 'react'

/**
 * Whether the viewport is at least `px` wide, following resizes: the same
 * breakpoints as Tailwind's `min-[Npx]:` / `max-[Npx]:` variants, for layout
 * decisions CSS alone can't make (which pane hosts the window controls).
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => typeof window.matchMedia !== 'function' || window.matchMedia(query).matches,
  )
}
