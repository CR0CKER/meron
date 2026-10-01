import { observable } from '@legendapp/state'
import { useValue } from '@legendapp/state/react'
import { useEffect } from 'react'
import { invoke } from './bridge'

/**
 * Symbolic icons from the desktop's icon theme (GTK, via the `icon.symbolic`
 * bridge command), as CSS mask URLs. `''` means the theme has none, or this
 * isn't GTK: keep the app's own icon. Missing means not asked yet.
 */
export const nativeIcons$ = observable<Record<string, string>>({})

const pending = new Set<string>()

/** A mask URL for an SVG: the icon's alpha shapes, drawn in currentColor. */
export function svgMaskUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export async function loadNativeIcon(name: string): Promise<void> {
  if (pending.has(name) || nativeIcons$[name].peek() !== undefined) return
  pending.add(name)
  try {
    const reply = await invoke<{ svg?: string }>('icon.symbolic', { name })
    const svg = typeof reply?.svg === 'string' ? reply.svg : ''
    nativeIcons$[name].set(svg ? svgMaskUrl(svg) : '')
  } catch {
    nativeIcons$[name].set('')
  } finally {
    pending.delete(name)
  }
}

/**
 * The mask URL for a theme icon once loaded, or '' (use your own icon). Pass
 * null to skip the lookup entirely.
 */
export function useNativeIcon(name: string | null): string {
  const mask = useValue(() => (name ? nativeIcons$[name].get() : undefined))
  useEffect(() => {
    if (name) void loadNativeIcon(name)
  }, [name])
  return mask ?? ''
}
