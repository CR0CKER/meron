import type { ReactNode } from 'react'
import type { PresencePhase } from '../../lib/usePresence'
import { TASKS_PANEL_WIDTH } from './TasksPanel'

// The Tasks panel slides in and out like the board's conversation pane
// (KanbanConversationPane): the frame grows from or shrinks to zero width
// while the panel inside keeps its full width, so the list is revealed rather
// than reflowed every frame. The panel is pinned to the window edge, so the
// title bar group it hosts there (TitlebarEnd) stays put while it slides.
// App owns the phase (usePresence), so the window controls stay on the panel
// until it has gone. The list stays on screen while the panel slides out.
export function TasksSlide({ phase, children }: { phase: PresencePhase; children: ReactNode }) {
  if (phase === 'closed') return null

  const animation = phase === 'entering' ? ' animate-pane-open' : phase === 'exiting' ? ' animate-tasks-close' : ''

  return (
    <div
      data-pane-phase={phase}
      // Hidden on a narrow window, like the panel itself.
      className={`flex min-h-0 shrink-0 justify-end overflow-hidden max-[900px]:hidden${animation}`}
      style={{ width: TASKS_PANEL_WIDTH }}
    >
      {children}
    </div>
  )
}
