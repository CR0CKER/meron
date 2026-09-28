import { useMemo } from 'react'
import { useActiveTheme } from '../../lib/useThemeChoice'
import { bubbleThemeFromTokens, readerThemeFromTokens, type BubbleTheme, type ReaderTheme } from './frameTheme'

/** The palette a reader body frame should paint with. */
export function useReaderTheme(): ReaderTheme {
  const def = useActiveTheme()
  return useMemo(() => readerThemeFromTokens(def.appearance, def.tokens), [def])
}

/** The palette a bubble body frame should paint with, for the bubble it sits in. */
export function useBubbleTheme(outgoing: boolean): BubbleTheme {
  const def = useActiveTheme()
  return useMemo(() => bubbleThemeFromTokens(def.appearance, def.tokens, outgoing), [def, outgoing])
}
