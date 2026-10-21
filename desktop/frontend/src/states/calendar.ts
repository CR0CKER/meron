import { invoke } from '../lib/bridge'
import { errorMessage } from '../lib/errors'
import { t } from '../lib/i18n'
import type { InviteResponse, Message } from '../types'
import { mail$ } from './mailState'
import { showToast } from './ui'

/** Show `response` on every loaded copy of the event — the invitation, an
 * update to it, the same message in another folder. */
function setInviteResponse(accountId: string, uid: string, response: InviteResponse | '') {
  mail$.messages.set(
    mail$.messages
      .get()
      .map((message) =>
        message.account_id === accountId && message.invite?.uid === uid
          ? { ...message, invite: { ...message.invite, response } }
          : message,
      ),
  )
}

/** Answer an invitation: the core sends the organizer an iMIP reply and
 * records the answer. The card shows it straight away and goes back if the
 * send fails. */
export async function respondToInvite(message: Message, response: InviteResponse) {
  const invite = message.invite
  if (!invite) return
  const previous = invite.response
  setInviteResponse(message.account_id, invite.uid, response)
  try {
    await invoke('invite.respond', { message: message.id, response })
  } catch (error) {
    setInviteResponse(message.account_id, invite.uid, previous)
    showToast(errorMessage(error, t('invite.respondFailed')), 'error')
  }
}
