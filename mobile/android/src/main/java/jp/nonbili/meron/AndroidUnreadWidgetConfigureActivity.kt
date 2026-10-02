package jp.nonbili.meron

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/** Picks a widget's background opacity, when it is placed and (Android 12+)
 *  whenever the user chooses to reconfigure it. */
class AndroidUnreadWidgetConfigureActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(localizedAppContext(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val appWidgetId =
            intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
                ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }
        // Backing out still keeps the widget, at its current (or default)
        // opacity: below Android 12 a cancelled result would remove it.
        val result = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
        setResult(Activity.RESULT_OK, result)
        AndroidUnreadWidget.repaint(this, appWidgetId)
        AndroidUnreadWidget.refreshAsync(this)

        val initial = AndroidUnreadWidget.opacity(this, appWidgetId)
        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                Surface {
                    OpacityPicker(
                        initial = initial,
                        onDone = { percent ->
                            AndroidUnreadWidget.setOpacity(this, appWidgetId, percent)
                            AndroidUnreadWidget.repaint(this, appWidgetId)
                            finish()
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun OpacityPicker(
    initial: Int,
    onDone: (Int) -> Unit,
) {
    var percent by remember { mutableFloatStateOf(initial.toFloat()) }
    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.mobile_android_widget_name), style = MaterialTheme.typography.titleLarge)
        Box(
            modifier = Modifier.align(Alignment.CenterHorizontally).size(72.dp),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier =
                    Modifier
                        .size(72.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(colorResource(R.color.widget_background).copy(alpha = percent / 100f)),
            )
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    painterResource(R.drawable.ic_stat_mail),
                    contentDescription = null,
                    tint = colorResource(R.color.widget_foreground),
                    modifier = Modifier.size(24.dp),
                )
                Text(
                    "3",
                    color = colorResource(R.color.widget_foreground),
                    style = MaterialTheme.typography.titleMedium,
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.mobile_android_widget_opacity), modifier = Modifier.weight(1f))
            Text("${percent.roundToInt()}%")
        }
        Slider(
            value = percent,
            onValueChange = { percent = it },
            valueRange = 0f..100f,
            steps = 19,
        )
        Spacer(Modifier.size(8.dp))
        Button(onClick = { onDone(percent.roundToInt()) }, modifier = Modifier.align(Alignment.End)) {
            Text(stringResource(R.string.buttons_done))
        }
    }
}
