import { useEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { BookmarkPlus, SlidersHorizontal } from 'lucide-react'
import { invoke } from '../../lib/bridge'
import { useTranslation } from '../../lib/i18n'
import { useEscapeKey } from '../../lib/useEscapeKey'
import { clsx } from '../../lib/utils'
import { kanbanColumnKey, type KanbanColumn } from '../../states/kanban'
import { Button } from '../button/Button'
import { Checkbox } from '../field/Checkbox'
import { useColumnLabel } from '../kanban/ColumnLabel'

/** The search options form, as the core's `search.parse` reads a query. */
export type SearchFields = {
  from: string
  to: string
  subject: string
  words: string
  /** `yyyy-mm-dd`, or empty. */
  after: string
  /** `yyyy-mm-dd`, or empty. */
  before: string
  unread: boolean
  starred: boolean
}

const EMPTY_FIELDS: SearchFields = {
  from: '',
  to: '',
  subject: '',
  words: '',
  after: '',
  before: '',
  unread: false,
  starred: false,
}

/** A board's part of the form: which column to search, and saving the search as a column. */
export type BoardSearchOptions = {
  /** `'all'` or a column key. */
  scope: string
  /** The columns a search can be scoped to. */
  columns: KanbanColumn[]
  onSave: (query: string, column: KanbanColumn) => void
}

export type SearchOptionsProps = {
  query: string
  /** `scope` is set on a board: the column picked under "Search in". */
  onSearch: (query: string, scope?: string) => void
  /** The search box: the form opens under it, as wide as it. Must be positioned. */
  anchorRef: RefObject<HTMLElement | null>
  board?: BoardSearchOptions
  /**
   * The form closed while focus was in it. Removing a focused field fires no
   * blur, so the box must take focus back, or anything tracking its focus is
   * left thinking it still has it.
   */
  onDismiss?: () => void
  /** In the title bar: its colors, until the search box around it is focused. */
  compact?: boolean
}

/**
 * Gmail-style search options: a form for the operators the core understands
 * (`from:`, `to:`, `subject:`, `is:unread`, …). The query text stays the
 * source of truth — opening reads the current query into the form, searching
 * writes the form back as query text — so typed operators and the form never
 * disagree.
 */
export function SearchOptions({ query, onSearch, anchorRef, board, onDismiss, compact = false }: SearchOptionsProps) {
  const { t } = useTranslation()
  const [fields, setFields] = useState<SearchFields | null>(null)
  const [scope, setScope] = useState('all')
  const columnLabel = useColumnLabel()
  const open = fields !== null
  const close = () => {
    const focused = !!document.activeElement?.closest('[data-search-options]')
    setFields(null)
    if (focused) onDismiss?.()
  }

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      // The form is portaled into the anchor, so this covers it too.
      if (!anchorRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  useEscapeKey(close, open)

  const toggle = async () => {
    if (open) {
      close()
      return
    }
    const parsed = await invoke<SearchFields>('search.parse', { query }).catch(() => null)
    setScope(board?.scope ?? 'all')
    setFields({ ...EMPTY_FIELDS, ...parsed, words: parsed ? parsed.words : query })
  }

  // Null when the core couldn't build it: the form then stays open with the
  // user's edits, rather than reading the failure as an empty search.
  const build = async () => {
    if (!fields) return null
    const built = await invoke<{ query: string }>('search.build', { fields }).catch(() => null)
    return built?.query ?? null
  }

  const submit = async () => {
    const built = await build()
    if (built === null) return
    onSearch(built, board ? scope : undefined)
    close()
  }

  const scopedColumn = board?.columns.find((column) => kanbanColumnKey(column) === scope)
  const save = async () => {
    if (!board || !scopedColumn) return
    const built = await build()
    if (!built) return
    board.onSave(built, scopedColumn)
    close()
  }

  // Nothing to save until some field is filled in.
  const empty =
    !fields ||
    (!fields.unread &&
      !fields.starred &&
      [fields.from, fields.to, fields.subject, fields.words, fields.after, fields.before].every((v) => !v.trim()))

  const set = <K extends keyof SearchFields>(key: K, value: SearchFields[K]) =>
    setFields((current) => (current ? { ...current, [key]: value } : current))

  const text = (key: 'from' | 'to' | 'subject' | 'words', label: string, autoFocus = false) => (
    <Row label={label}>
      <input
        autoFocus={autoFocus}
        value={fields?.[key] ?? ''}
        onChange={(event) => set(key, event.target.value)}
        className={inputClass}
      />
    </Row>
  )

  const date = (key: 'after' | 'before', label: string) => (
    <Row label={label}>
      <input
        type="date"
        value={fields?.[key] ?? ''}
        onChange={(event) => set(key, event.target.value)}
        className={inputClass}
      />
    </Row>
  )

  const anchor = anchorRef.current
  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        className={clsx(
          'flex shrink-0 cursor-pointer items-center transition-colors',
          open
            ? 'text-accent'
            : compact
              ? 'text-sidenav-ink/60 hover:text-sidenav-ink group-focus-within:text-secondary group-focus-within:hover:text-primary'
              : 'text-secondary hover:text-primary',
        )}
        aria-label={t('search.options')}
        aria-expanded={open}
        title={t('search.options')}
      >
        <SlidersHorizontal size={14} />
      </button>
      {fields &&
        anchor &&
        createPortal(
          // data-no-drag: in the title bar, a press inside the form must not move the window.
          <form
            data-search-options
            data-no-drag
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
            className="absolute top-full left-0 z-50 mt-1.5 flex w-full min-w-96 flex-col gap-2 rounded-2xl border border-border bg-chats p-4 shadow-xl shadow-black/10 animate-slide-up dark:shadow-black/35"
          >
            {board && (
              <Row label={t('search.searchIn')}>
                <select value={scope} onChange={(event) => setScope(event.target.value)} className={inputClass}>
                  <option value="all">{t('kanban.searchScope.allColumns')}</option>
                  {board.columns.map((column) => {
                    const label = columnLabel(column)
                    return (
                      <option key={kanbanColumnKey(column)} value={kanbanColumnKey(column)}>
                        {label.account ? `${label.folder} · ${label.account}` : label.folder}
                      </option>
                    )
                  })}
                </select>
              </Row>
            )}
            {text('from', t('composer.fields.from'), true)}
            {text('to', t('composer.fields.to'))}
            {text('subject', t('composer.fields.subject'))}
            {text('words', t('search.hasWords'))}
            {date('after', t('search.after'))}
            {date('before', t('search.before'))}
            <div className="flex items-center gap-5 pt-1 text-xs text-primary">
              <label className="flex cursor-pointer items-center gap-2 select-none">
                <Checkbox checked={fields.unread} onChange={(event) => set('unread', event.target.checked)} />
                {t('filters.unread')}
              </label>
              <label className="flex cursor-pointer items-center gap-2 select-none">
                <Checkbox checked={fields.starred} onChange={(event) => set('starred', event.target.checked)} />
                {t('filters.starred')}
              </label>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              {board ? (
                // A saved search lives in one folder, so it needs a column picked above.
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={BookmarkPlus}
                  disabled={empty || !scopedColumn}
                  onClick={() => void save()}
                >
                  {t('kanban.actions.saveSearchAsColumn')}
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" size="sm">
                {t('kanban.actions.search')}
              </Button>
            </div>
          </form>,
          anchor,
        )}
    </>
  )
}

const inputClass =
  'min-w-0 flex-1 rounded-lg bg-app px-2 py-1.5 text-xs text-primary outline-none ring-1 ring-border focus:ring-accent'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs text-secondary">{label}</span>
      {children}
    </label>
  )
}
