package jp.nonbili.meron.ui

import jp.nonbili.meron.shared.InviteRespondParams
import jp.nonbili.meron.shared.MessageBody
import jp.nonbili.meron.shared.MobileMailCommandClient
import jp.nonbili.meron.shared.requireCoreOk
import kotlinx.coroutines.withContext

/** Show [response] on every loaded copy of the event — the invitation, an
 *  update to it, the same message in another folder. */
private fun MeronMobileState.setInviteResponse(
    uid: String,
    response: String,
) {
    messages =
        messages.map { message ->
            val invite = message.invite
            if (invite != null && invite.uid == uid) message.copy(invite = invite.copy(response = response)) else message
        }
}

/**
 * Answer an invitation: the core sends the organizer an iMIP reply and
 * records the answer. The card shows it straight away and goes back if the
 * send fails. Mirrors desktop's `respondToInvite`.
 */
internal suspend fun MeronMobileState.respondToInvite(
    message: MessageBody,
    response: String,
) {
    val invite = message.invite ?: return
    if (!coreLoaded) {
        status = coreUnavailableMessage
        return
    }
    val previous = invite.response
    setInviteResponse(invite.uid, response)
    runCatching {
        withContext(ioDispatcher) {
            requireCoreOk(MobileMailCommandClient(core).respondToInvite(InviteRespondParams(message.id, response)))
        }
    }.onFailure {
        setInviteResponse(invite.uid, previous)
        status = trsError("invite.respondFailed", it)
    }
}
