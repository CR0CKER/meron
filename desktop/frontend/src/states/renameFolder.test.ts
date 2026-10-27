import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Folder } from '../types'
// Initialize the account/boot dependency graph before importing mail directly.
import './accounts'
import { mail$ } from './mail'
import { renameFolder } from './mailFolders'
import { recentThreadTransfers$ } from './recentThreadTransfers'
import { settleConfirm, ui$ } from './ui'
import { compose$ } from './composeState'
import { kanban$ } from './kanban'
import type { MessageTab } from '../types'

const folder = (id: string, name = id): Folder => ({
  id,
  account_id: 'acc',
  name,
  role: 'folder',
  delimiter: '/',
  unread: 0,
})

describe('renameFolder', () => {
  let previousGo: unknown
  let calls: { method: string; payload: any }[]

  beforeEach(() => {
    previousGo = (window as any).go
    calls = []
    mail$.foldersByAccount.set({ acc: [folder('Work'), folder('Work/Reports')] })
    ui$.selectedAccount.set('acc')
    ui$.selectedFolder.set('Work/Reports')
    recentThreadTransfers$.set([
      { action: 'move', sourceAccountId: 'acc', targetAccountId: 'acc', targetFolderId: 'Work/Reports' },
    ])
    ;(window as any).go = {
      main: {
        App: {
          Invoke: async (method: string, payload: unknown) => {
            calls.push({ method, payload })
            return {
              ok: true,
              renamed: [['Work/Reports', 'Work/Q3']],
              folders: [folder('Work'), folder('Work/Q3')],
            }
          },
        },
      },
    }
  })

  afterEach(() => {
    if (ui$.confirm.peek()) settleConfirm(false)
    recentThreadTransfers$.set([])
    if (previousGo === undefined) delete (window as any).go
    else (window as any).go = previousGo
  })

  it('renames the leaf in place and repoints what showed the folder', async () => {
    const tab = (id: string, folderId: string) =>
      ({
        id,
        kind: 'thread',
        messageId: '',
        threadId: id,
        accountId: 'acc',
        folderId,
        subject: '',
        from: '',
        body: '',
        viewMode: 'plain',
      }) as MessageTab
    compose$.tabs.set([tab('thread-a', 'Work/Reports'), tab('thread-b', 'Work')])
    // A board's pane shows a card from the folder.
    const card = { thread_id: 'acc#Work/Reports#7', account_id: 'acc', folder_id: 'Work/Reports' } as any
    mail$.threads.set([card])
    kanban$.paneThreadId.set(card.thread_id)
    const renaming = renameFolder('acc', folder('Work/Reports'))
    // The prompt offers the folder's own name, not its path.
    expect(ui$.confirm.input.value.peek()).toBe('Reports')
    ui$.confirm.input.value.set(' Q3 ')
    settleConfirm(true)
    expect(await renaming).toBe(true)

    const call = calls.find((item) => item.method === 'mail.folderRename')
    expect(call?.payload).toEqual({ account_id: 'acc', folder_id: 'Work/Reports', name: 'Work/Q3' })
    expect(mail$.foldersByAccount.acc.peek()?.map((item) => item.id)).toEqual(['Work', 'Work/Q3'])
    expect(ui$.selectedFolder.peek()).toBe('Work/Q3')
    expect(recentThreadTransfers$.peek()[0]?.targetFolderId).toBe('Work/Q3')
    // A tab on the old name is closed; one elsewhere stays.
    expect(compose$.tabs.peek().map((item) => item.id)).toEqual(['thread-b'])
    expect(kanban$.paneThreadId.peek()).toBe('')
    compose$.tabs.set([])
    mail$.threads.set([])
  })

  it('does nothing when cancelled or left unchanged', async () => {
    const cancelled = renameFolder('acc', folder('Work/Reports'))
    settleConfirm(false)
    expect(await cancelled).toBe(false)

    const unchanged = renameFolder('acc', folder('Work/Reports'))
    settleConfirm(true)
    expect(await unchanged).toBe(false)
    expect(calls.some((item) => item.method === 'mail.folderRename')).toBe(false)
  })
})
