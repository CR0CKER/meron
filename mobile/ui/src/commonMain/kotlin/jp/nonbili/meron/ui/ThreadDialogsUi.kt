package jp.nonbili.meron.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AlternateEmail
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.History
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import jp.nonbili.meron.shared.AccountSummary
import jp.nonbili.meron.shared.FolderSummary
import jp.nonbili.meron.shared.ThreadSummary

@Composable
internal fun MoveThreadDialog(
    thread: ThreadSummary,
    folders: List<FolderSummary>,
    accounts: List<AccountSummary> = emptyList(),
    recentTransfers: List<RecentThreadTransferItem> = emptyList(),
    onMove: (FolderSummary) -> Unit,
    onCreateAndMove: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    ThreadDestinationDialog(
        thread,
        folders,
        accounts,
        recentTransfers.forAction("move"),
        "threads.moveConversation",
        "folders.noOtherAvailable",
        onMove,
        onDismiss,
    )
}

@Composable
internal fun CopyThreadDialog(
    thread: ThreadSummary,
    folders: List<FolderSummary>,
    accounts: List<AccountSummary> = emptyList(),
    recentTransfers: List<RecentThreadTransferItem> = emptyList(),
    onCopy: (FolderSummary) -> Unit,
    onDismiss: () -> Unit,
) {
    ThreadDestinationDialog(
        thread,
        folders,
        accounts,
        recentTransfers.forAction("copy"),
        "threads.copyConversation",
        "folders.noCopyTargets",
        onCopy,
        onDismiss,
    )
}

/**
 * Recent targets of this action first, then the thread's own account folders,
 * then one row per other account that expands to that account's folders.
 */
@Composable
private fun ThreadDestinationDialog(
    thread: ThreadSummary,
    folders: List<FolderSummary>,
    accounts: List<AccountSummary>,
    recents: List<RecentThreadTransferItem>,
    titleKey: String,
    emptyKey: String,
    onPick: (FolderSummary) -> Unit,
    onDismiss: () -> Unit,
) {
    val foldersByAccount = folders.groupBy { it.accountId.ifBlank { thread.accountId } }
    val accountGroups =
        if (accounts.isNotEmpty()) {
            accounts.map { account -> account.id to account.displayName.ifBlank { account.email.ifBlank { account.id } } }
        } else {
            foldersByAccount.keys.map { accountId -> accountId to accountId }
        }

    fun targetFolders(accountId: String) =
        foldersByAccount[accountId]
            .orEmpty()
            .filterNot { folder ->
                accountId == thread.accountId &&
                    folder.name.equals(thread.folder, ignoreCase = true)
            }
    val ownAccount = accountGroups.firstOrNull { (accountId, _) -> accountId == thread.accountId }
    val otherAccounts = accountGroups.filterNot { (accountId, _) -> accountId == thread.accountId }
    val targetCount = accountGroups.sumOf { (accountId, _) -> targetFolders(accountId).size }
    var expandedAccountId by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(titleKey)) },
        text = {
            val listState = rememberLazyListState()
            LazyColumn(
                Modifier.heightIn(max = 420.dp).appScrollbar(listState),
                state = listState,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                item {
                    Text(
                        thread.subject.ifBlank { tr("threads.noSubject") },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (targetCount == 0 && recents.isEmpty()) {
                    item {
                        Text(
                            tr(emptyKey),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(vertical = 12.dp),
                        )
                    }
                    return@LazyColumn
                }
                items(recents, key = { "recent:${it.transfer.targetAccountId}\n${it.folder.name}" }) { recent ->
                    DestinationAction(Icons.Filled.History, recent.destination) {
                        onPick(recent.folder.copy(accountId = recent.transfer.targetAccountId))
                    }
                }
                if (recents.isNotEmpty() && accountGroups.isNotEmpty()) {
                    item(key = "recent-divider") { HorizontalDivider(Modifier.padding(vertical = 4.dp)) }
                }
                if (ownAccount != null) {
                    val ownFolders = targetFolders(ownAccount.first)
                    if (ownFolders.isEmpty()) {
                        item(key = "empty:${ownAccount.first}") { NoFoldersText() }
                    } else {
                        items(ownFolders, key = { "${ownAccount.first}\n${it.name}" }) { folder ->
                            FolderDestinationAction(folder) { onPick(folder) }
                        }
                    }
                    if (otherAccounts.isNotEmpty()) {
                        item(key = "account-divider") { HorizontalDivider(Modifier.padding(vertical = 4.dp)) }
                    }
                }
                otherAccounts.forEach { (accountId, accountLabel) ->
                    val expanded = expandedAccountId == accountId
                    item(key = "account:$accountId") {
                        DestinationAction(
                            Icons.Filled.AlternateEmail,
                            accountLabel,
                            trailing = if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                        ) {
                            expandedAccountId = if (expanded) null else accountId
                        }
                    }
                    if (expanded) {
                        val accountFolders = targetFolders(accountId)
                        if (accountFolders.isEmpty()) {
                            item(key = "empty:$accountId") { NoFoldersText(Modifier.padding(start = 16.dp)) }
                        } else {
                            items(accountFolders, key = { "$accountId\n${it.name}" }) { folder ->
                                FolderDestinationAction(folder, Modifier.padding(start = 16.dp)) { onPick(folder) }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(tr("buttons.cancel")) }
        },
    )
}

@Composable
private fun NoFoldersText(modifier: Modifier = Modifier) {
    Text(
        tr("folders.noneAvailable"),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall,
        modifier = modifier.padding(horizontal = 8.dp, vertical = 6.dp),
    )
}

@Composable
internal fun FolderDestinationAction(
    folder: FolderSummary,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    DestinationAction(folderIcon(folder), folder.displayName.replaceFirstChar { it.uppercase() }, modifier, onClick = onClick)
}

@Composable
private fun DestinationAction(
    icon: ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    trailing: ImageVector? = null,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick, modifier = modifier.fillMaxWidth()) {
        Icon(
            icon,
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.width(10.dp))
        Text(
            label,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (trailing != null) {
            Icon(
                trailing,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
