import { describe, expect, it } from 'bun:test'
import { paneTitlebarSlots, type PaneLayout } from './paneSlots'

const wide: PaneLayout = {
  kanban: false,
  kanbanPaneOpen: false,
  tasksOpen: false,
  tasksFit: true,
  split: true,
  mobilePane: 'threads',
}

// The Tasks panel is only drawn while it is on screen (TasksSlide), so its
// slot only counts when it is open.
const ends = (layout: PaneLayout) => {
  const slots = paneTitlebarSlots(layout)
  return {
    list: slots.list.end,
    conversation: slots.conversation.end,
    tasks: layout.tasksOpen && slots.tasks.end,
  }
}

const starts = (layout: PaneLayout) => {
  const slots = paneTitlebarSlots(layout)
  return { list: slots.list.start, conversation: slots.conversation.start, tasks: slots.tasks.start }
}

describe('paneTitlebarSlots', () => {
  it('gives the start to the thread list and the end to the conversation', () => {
    expect(starts(wide)).toEqual({ list: true, conversation: false, tasks: false })
    expect(ends(wide)).toEqual({ list: false, conversation: true, tasks: false })
  })

  it('moves the end to the Tasks panel while it is open', () => {
    expect(ends({ ...wide, tasksOpen: true })).toEqual({ list: false, conversation: false, tasks: true })
  })

  it('keeps the end off the Tasks panel below 900px, where it hides itself', () => {
    expect(ends({ ...wide, tasksOpen: true, tasksFit: false })).toEqual({
      list: false,
      conversation: true,
      tasks: false,
    })
  })

  it('gives the kanban board both sides until its conversation pane opens', () => {
    expect(ends({ ...wide, kanban: true })).toEqual({ list: true, conversation: false, tasks: false })
    expect(ends({ ...wide, kanban: true, kanbanPaneOpen: true })).toEqual({
      list: false,
      conversation: true,
      tasks: false,
    })
  })

  it('gives both sides to the one pane a narrow window shows', () => {
    const narrow = { ...wide, split: false, tasksFit: false }
    expect(paneTitlebarSlots(narrow).list).toEqual({ start: true, end: true })
    expect(paneTitlebarSlots(narrow).conversation).toEqual({ start: false, end: false })
    const reading = { ...narrow, mobilePane: 'conversation' as const }
    expect(paneTitlebarSlots(reading).list).toEqual({ start: false, end: false })
    expect(paneTitlebarSlots(reading).conversation).toEqual({ start: true, end: true })
  })

  it('never hands a slot to the Tasks panel on a narrow window', () => {
    const slots = paneTitlebarSlots({ ...wide, split: false, tasksFit: false, tasksOpen: true })
    expect(slots.tasks).toEqual({ start: false, end: false })
  })

  it('keeps the start on a narrow kanban board, which stays on screen', () => {
    const narrowKanban = { ...wide, kanban: true, split: false, tasksFit: false }
    expect(paneTitlebarSlots(narrowKanban).list).toEqual({ start: true, end: true })
    const reading = { ...narrowKanban, kanbanPaneOpen: true, mobilePane: 'conversation' as const }
    expect(paneTitlebarSlots(reading).list).toEqual({ start: true, end: false })
    expect(paneTitlebarSlots(reading).conversation).toEqual({ start: false, end: true })
  })

  it('folds the room in the header beside the Tasks panel shut while it is open', () => {
    const open = paneTitlebarSlots({ ...wide, tasksOpen: true })
    expect(open.conversation).toEqual({ start: false, end: false, fold: true })
    expect(open.tasks.end).toBe(true)
    expect(paneTitlebarSlots(wide).conversation).toEqual({ start: false, end: true, fold: true })
    const board = paneTitlebarSlots({ ...wide, kanban: true, tasksOpen: true })
    expect(board.list).toEqual({ start: true, end: false, fold: true })
  })

  it("folds the room in the board's header with the conversation pane instead of keeping a gap", () => {
    const reading = paneTitlebarSlots({ ...wide, kanban: true, kanbanPaneOpen: true })
    expect(reading.list).toEqual({ start: true, end: false, fold: true })
    expect(reading.conversation.end).toBe(true)
    // The thread list never holds the end beside a conversation, so it needs no room.
    expect(paneTitlebarSlots(wide).list).toEqual({ start: true, end: false, fold: false })
  })
})
