import { useEffect, useRef, useState } from 'react'
import { FolderPlus, Loader2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { useValue } from '@legendapp/state/react'
import { pickDelimiter } from '../../lib/folderTree'
import { mail$ } from '../../states/mail'
import { createFolder } from '../../states/mailFolders'
import type { Folder } from '../../types'
import { IconButton } from '../button/IconButton'
import { TextInput } from '../field/Field'

// Name a new folder in an account and create it: on the account's server, or
// in local folders. The folder picker offers it for every mail account.
export function NewFolderForm({
  accountId,
  autoFocus = false,
  onCreated,
}: {
  accountId: string
  autoFocus?: boolean
  onCreated?: (folder: Folder) => void
}) {
  const { t } = useTranslation()
  const folders = useValue(mail$.foldersByAccount[accountId]) ?? []
  // Nest with the server's own separator ("/" on most, "." on some).
  const delimiter = pickDelimiter(folders)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  // A slow server can answer after the picker closed or moved to another
  // account. The folder is made either way, but only the form that asked may
  // act on it: selecting it then would point the view somewhere else.
  const mounted = useRef(true)
  const currentAccountId = useRef(accountId)
  currentAccountId.current = accountId
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const create = async () => {
    if (creating) return
    const requestedAccountId = accountId
    const stillAsking = () => mounted.current && currentAccountId.current === requestedAccountId
    setCreating(true)
    setError('')
    try {
      const folder = await createFolder(requestedAccountId, name)
      if (!stillAsking()) return
      setName('')
      onCreated?.(folder)
    } catch (err) {
      if (stillAsking()) setError(err instanceof Error ? err.message : t('folders.createFailed'))
    } finally {
      if (mounted.current) setCreating(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <div className="flex items-center gap-1.5 rounded-lg bg-hover p-1">
        <TextInput
          autoFocus={autoFocus}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (error) setError('')
          }}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder={t('folders.namePlaceholder')}
          disabled={creating}
          className="h-7 min-w-0 flex-1 rounded-md px-2 font-medium"
        />
        <IconButton
          icon={creating ? undefined : FolderPlus}
          label={t('folders.create')}
          size="sm"
          radius="lg"
          variant="accentSoft"
          disabled={creating || !name.trim()}
          type="submit"
        >
          {creating && <Loader2 size={14} className="animate-spin" />}
        </IconButton>
      </div>
      <p className={`px-1 text-[0.65625rem] font-medium ${error ? 'text-rose-500' : 'text-secondary'}`}>
        {error || t('folders.subfolderHint', { delimiter })}
      </p>
    </form>
  )
}
