package jp.nonbili.meron

import jp.nonbili.meron.shared.FolderSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidUnreadWidgetTest {
    @Test
    fun countsOnlyTheInbox() {
        val folders =
            listOf(
                FolderSummary(accountId = "a", name = "Notifications", unread = 9),
                FolderSummary(accountId = "a", name = "INBOX", unread = 3, role = "inbox"),
            )
        assertEquals(3, widgetInboxUnread(folders))
    }

    @Test
    fun matchesInboxByNameWithoutRole() {
        assertEquals(4, widgetInboxUnread(listOf(FolderSummary(accountId = "a", name = "Inbox", unread = 4))))
        assertEquals(0, widgetInboxUnread(emptyList()))
    }

    @Test
    fun capsTheLabel() {
        assertEquals("0", widgetCountLabel(0))
        assertEquals("999", widgetCountLabel(999))
        assertEquals("999+", widgetCountLabel(1000))
    }
}
