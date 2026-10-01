import type { TitlebarSlots } from './WindowControls'

export type PaneLayout = {
  /** The kanban board is open instead of the thread list. */
  kanban: boolean
  /** The conversation pane is open beside the kanban board. */
  kanbanPaneOpen: boolean
  /** The Tasks panel is open, or opening (it hides itself below 900px). Not
   * while it slides out: the header beside it folds its room back meanwhile. */
  tasksOpen: boolean
  /** At least 900px wide: the Tasks panel can show. */
  tasksFit: boolean
  /** At least 769px wide: list and conversation sit side by side. */
  split: boolean
  /** Which pane a narrow window shows. */
  mobilePane: 'threads' | 'conversation'
}

export type PaneSlots = { list: TitlebarSlots; conversation: TitlebarSlots; tasks: TitlebarSlots }

const NONE: TitlebarSlots = { start: false, end: false }

/**
 * Which pane headers host the window controls when they are the title bar
 * (Linux): `start` goes to the leftmost visible content pane (the side
 * navigation is too narrow for three buttons), `end` to the rightmost visible
 * one. Panes that CSS hides at the current width never get a slot, so the
 * controls can't vanish with them.
 *
 * `fold` marks a header whose room for the window's corner group
 * (TitlebarEnd) comes and goes with a pane sliding in to its right, the
 * Tasks panel or the board's conversation pane: the room folds shut as the
 * pane opens and back as it closes, timed like the pane, so there is no gap
 * beside the pane and the header's own buttons glide instead of jumping.
 */
export function paneTitlebarSlots(layout: PaneLayout): PaneSlots {
  const { kanban, kanbanPaneOpen, tasksOpen, tasksFit, split, mobilePane } = layout
  const tasks = tasksOpen && tasksFit

  if (!split) {
    // One pane at a time, except the kanban board, which stays on screen with
    // the conversation stacked after it.
    const conversation = mobilePane === 'conversation' && (!kanban || kanbanPaneOpen)
    if (kanban) {
      return {
        list: { start: true, end: !conversation },
        conversation: { start: false, end: conversation },
        tasks: NONE,
      }
    }
    return {
      list: conversation ? NONE : { start: true, end: true },
      conversation: conversation ? { start: true, end: true } : NONE,
      tasks: NONE,
    }
  }

  const conversationShown = !kanban || kanbanPaneOpen
  return {
    list: { start: true, end: !conversationShown && !tasks, fold: kanban },
    conversation: { start: false, end: conversationShown && !tasks, fold: conversationShown },
    // Only drawn while it is on screen (TasksSlide), always at the window edge.
    tasks: { start: false, end: tasksFit },
  }
}

export const NO_PANE_SLOTS: PaneSlots = { list: NONE, conversation: NONE, tasks: NONE }
