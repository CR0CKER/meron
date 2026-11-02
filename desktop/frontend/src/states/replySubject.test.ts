import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Message } from '../types'
import { mail$ } from './mail'
import { replySubject } from './composeReply'

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'm1',
  account_id: 'acc',
  folder_id: 'inbox',
  thread_id: 't1',
  from_name: 'Aki',
  from_addr: 'aki@example.com',
  to: 'me@example.com',
  subject: 'Topic',
  preview: '',
  body: '',
  date: 100,
  unread: false,
  starred: false,
  has_attachments: false,
  ...overrides,
})

describe('replySubject', () => {
  beforeEach(() => mail$.messages.set([]))
  afterEach(() => mail$.messages.set([]))

  it('prefixes a plain subject once, as before', () => {
    expect(replySubject('Topic', 't1')).toBe('Re: Topic')
    expect(replySubject('Re: Topic', 't1')).toBe('Re: Topic')
    expect(replySubject('', 't1')).toBe('Re: ')
  })

  it("takes a decrypted subject from the thread instead of an encrypted message's placeholder", () => {
    mail$.messages.set([
      message({ id: 'a', subject: '[...]', date: 50 }),
      message({ id: 'b', subject: 'Testing This', date: 100 }),
      message({ id: 'c', subject: 'Re: Testing This', date: 200 }),
      message({ id: 'x', thread_id: 'other', subject: 'Elsewhere', date: 10 }),
    ])
    expect(replySubject('[...]', 't1')).toBe('Re: Testing This')
    expect(replySubject('...', 't1')).toBe('Re: Testing This')
    expect(replySubject('Re: [...]', 't1')).toBe('Re: Testing This')
  })

  it('sends no subject made from the placeholder when nothing in the thread is decrypted', () => {
    mail$.messages.set([message({ subject: 'Re: [...]' })])
    expect(replySubject('[...]', 't1')).toBe('')
  })
})
