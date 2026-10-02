package jp.nonbili.meron

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.util.Log
import android.widget.RemoteViews
import jp.nonbili.meron.shared.FolderSummary
import jp.nonbili.meron.shared.coreErrorMessage
import jp.nonbili.meron.shared.parseAccountListResponse
import jp.nonbili.meron.shared.parseFolderListResponse
import org.json.JSONObject
import java.util.concurrent.Executors

/** Home-screen widget showing how much inbox mail is unread, across accounts. */
class AndroidUnreadWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        AndroidUnreadWidget.refreshAsync(context, goAsync())
    }

    override fun onDeleted(
        context: Context,
        appWidgetIds: IntArray,
    ) {
        AndroidUnreadWidget.forget(context, appWidgetIds)
    }
}

object AndroidUnreadWidget {
    private const val TAG = "MeronWidget"
    private const val PREFS = "meron_widget"
    private const val PREF_LAST_COUNT = "last_count"
    const val DEFAULT_OPACITY = 85

    /** One thread so concurrent triggers (a sync finishing as the app stops)
     *  queue instead of racing to paint stale counts over fresh ones. */
    private val executor = Executors.newSingleThreadExecutor()

    fun opacity(
        context: Context,
        appWidgetId: Int,
    ): Int = prefs(context).getInt(opacityKey(appWidgetId), DEFAULT_OPACITY)

    fun setOpacity(
        context: Context,
        appWidgetId: Int,
        percent: Int,
    ) {
        prefs(context).edit().putInt(opacityKey(appWidgetId), percent.coerceIn(0, 100)).apply()
    }

    fun forget(
        context: Context,
        appWidgetIds: IntArray,
    ) {
        prefs(context).edit().apply { appWidgetIds.forEach { remove(opacityKey(it)) } }.apply()
    }

    /** Recounts off the calling thread. Every place that changes unread state
     *  outside the widget calls this; it is a no-op when no widget is placed. */
    fun refreshAsync(
        context: Context,
        pending: BroadcastReceiver.PendingResult? = null,
    ) {
        val app = context.applicationContext
        executor.execute {
            try {
                refresh(app)
            } catch (error: RuntimeException) {
                Log.w(TAG, "widget refresh failed: ${error.message}")
            } finally {
                pending?.finish()
            }
        }
    }

    /** Repaints one widget with the last known count, e.g. after its opacity
     *  changed. Cheap: no core round-trip. */
    fun repaint(
        context: Context,
        appWidgetId: Int,
    ) {
        val count = prefs(context).getInt(PREF_LAST_COUNT, 0)
        AppWidgetManager.getInstance(context).updateAppWidget(appWidgetId, views(context, appWidgetId, count))
    }

    private fun refresh(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, AndroidUnreadWidgetProvider::class.java))
        if (ids.isEmpty()) return
        // A failed read keeps the last count rather than flashing zero.
        val count = readInboxUnread(context) ?: prefs(context).getInt(PREF_LAST_COUNT, 0)
        prefs(context).edit().putInt(PREF_LAST_COUNT, count).apply()
        ids.forEach { manager.updateAppWidget(it, views(context, it, count)) }
    }

    /** Sum of every account's inbox unread, read from the local store — no
     *  network, so it is cheap enough to run on every change. */
    private fun readInboxUnread(context: Context): Int? {
        if (!MeronCoreNative.isLoaded()) return null
        MeronCoreNative.initJson(context.filesDir.absolutePath, MeronDbKey.get(context))
        val accountsResponse = MeronCoreNative.invokeJson(requestJson(1, "account.list"))
        if (coreErrorMessage(accountsResponse) != null) return null
        return parseAccountListResponse(accountsResponse).sumOf { account ->
            val foldersResponse =
                MeronCoreNative.invokeJson(
                    requestJson(2, "mail.folderList", JSONObject().put("account_id", account.id)),
                )
            if (coreErrorMessage(foldersResponse) != null) return null
            widgetInboxUnread(parseFolderListResponse(foldersResponse))
        }
    }

    private fun views(
        context: Context,
        appWidgetId: Int,
        count: Int,
    ): RemoteViews =
        RemoteViews(context.packageName, R.layout.unread_widget).apply {
            setTextViewText(R.id.widget_count, widgetCountLabel(count))
            setInt(R.id.widget_background, "setImageAlpha", opacity(context, appWidgetId) * 255 / 100)
            setContentDescription(
                R.id.widget_root,
                "${context.getString(R.string.mobile_android_widget_name)}: $count",
            )
            setOnClickPendingIntent(R.id.widget_root, AndroidNotificationService.openAppIntent(context))
        }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun opacityKey(appWidgetId: Int) = "opacity_$appWidgetId"

    private fun requestJson(
        id: Long,
        method: String,
        params: JSONObject = JSONObject(),
    ): String =
        JSONObject()
            .put("id", id)
            .put("method", method)
            .put("params", params)
            .toString()
}

/** An account's inbox unread — the mail that raises new-mail notifications,
 *  matching the desktop tray. INBOX is matched by name too, for stores that
 *  predate folder roles. */
internal fun widgetInboxUnread(folders: List<FolderSummary>): Int = folders.firstOrNull { it.role == "inbox" || it.name.equals("INBOX", ignoreCase = true) }?.unread ?: 0

/** Fits a 1x1 cell: four digits would crowd the icon. */
internal fun widgetCountLabel(count: Int): String = if (count > 999) "999+" else count.coerceAtLeast(0).toString()
