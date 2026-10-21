package jp.nonbili.meron.ui

/** [IsoDate] is the machine-readable `YYYY-MM-DD` a typed due date uses; every
 *  other style is for display and follows the device's locale. */
internal enum class DateStyle { Time, Weekday, MonthDay, MonthDayYear, WeekdayDate, FullTimestamp, IsoDate }

/** Locale-aware short date; only this piece needs platform date formatting. */
internal expect fun formatDate(
    epochMillis: Long,
    style: DateStyle,
): String

internal expect fun isSameLocalDate(
    epochMillis: Long,
    referenceEpochMillis: Long,
): Boolean

internal expect fun isSameLocalYear(
    epochMillis: Long,
    referenceEpochMillis: Long,
): Boolean

/** Local midnight on the given calendar date, as epoch seconds. A due date is a
 *  day, not an instant, so it is anchored where the user's day starts. */
internal expect fun epochSecondsForLocalDate(
    year: Int,
    month: Int,
    day: Int,
): Long

internal fun formatInboxTimestamp(
    epochSeconds: Long,
    nowMillis: Long = currentTimeMillis(),
    sameLocalDate: (Long, Long) -> Boolean = ::isSameLocalDate,
    sameLocalYear: (Long, Long) -> Boolean = ::isSameLocalYear,
    dateFormatter: (Long, DateStyle) -> String = ::formatDate,
): String {
    if (epochSeconds <= 0) return ""
    val thenMillis = epochSeconds * 1000
    return when {
        sameLocalDate(thenMillis, nowMillis) -> dateFormatter(thenMillis, DateStyle.Time)
        sameLocalYear(thenMillis, nowMillis) -> dateFormatter(thenMillis, DateStyle.MonthDay)
        else -> dateFormatter(thenMillis, DateStyle.MonthDayYear)
    }
}

internal fun formatMessageFullTimestamp(
    epochSeconds: Long,
    dateFormatter: (Long, DateStyle) -> String = ::formatDate,
): String {
    if (epochSeconds <= 0) return ""
    return dateFormatter(epochSeconds * 1000, DateStyle.FullTimestamp)
}

internal fun formatRelativeTime(epochSeconds: Long): String {
    if (epochSeconds <= 0) return ""
    val nowMillis = currentTimeMillis()
    val thenMillis = epochSeconds * 1000
    val diff = nowMillis - thenMillis
    return when {
        diff < 60_000 -> "now"
        diff < 3_600_000 -> "${diff / 60_000}m"
        diff < 86_400_000 -> "${diff / 3_600_000}h"
        diff < 7 * 86_400_000L -> formatDate(thenMillis, DateStyle.Weekday)
        else -> formatDate(thenMillis, DateStyle.MonthDay)
    }
}

/** A task's due date: month/day, with the year once it isn't the current one. */
internal fun formatTaskDueDate(
    epochSeconds: Long,
    nowMillis: Long = currentTimeMillis(),
    sameLocalYear: (Long, Long) -> Boolean = ::isSameLocalYear,
    dateFormatter: (Long, DateStyle) -> String = ::formatDate,
): String {
    if (epochSeconds <= 0) return ""
    val thenMillis = epochSeconds * 1000
    val style = if (sameLocalYear(thenMillis, nowMillis)) DateStyle.MonthDay else DateStyle.MonthDayYear
    return dateFormatter(thenMillis, style)
}

/** Whether a due date has already passed, so the row can call it out. */
internal fun taskIsOverdue(
    dueAtSeconds: Long,
    nowMillis: Long = currentTimeMillis(),
): Boolean = dueAtSeconds > 0 && dueAtSeconds * 1000 < nowMillis && !isSameLocalDate(dueAtSeconds * 1000, nowMillis)

/**
 * When a calendar event happens: its day (or days), and its times unless it
 * lasts all day. All-day bounds are UTC midnights with an exclusive end, so the
 * calendar dates are read in UTC and shown as those same local dates.
 */
internal fun formatEventRange(
    start: Long,
    end: Long,
    allDay: Boolean,
    sameLocalDate: (Long, Long) -> Boolean = ::isSameLocalDate,
    localDate: (Int, Int, Int) -> Long = ::epochSecondsForLocalDate,
    dateFormatter: (Long, DateStyle) -> String = ::formatDate,
): String {
    if (start <= 0) return ""
    if (allDay) {
        val first = localDateOfUtcDay(start, localDate)
        val last = localDateOfUtcDay(maxOf(start, end - 86_400), localDate)
        val from = dateFormatter(first * 1000, DateStyle.WeekdayDate)
        return if (last == first) from else "$from – ${dateFormatter(last * 1000, DateStyle.WeekdayDate)}"
    }
    val from = dateFormatter(start * 1000, DateStyle.FullTimestamp)
    return when {
        end <= start -> from
        sameLocalDate(start * 1000, end * 1000) -> "$from – ${dateFormatter(end * 1000, DateStyle.Time)}"
        else -> "$from – ${dateFormatter(end * 1000, DateStyle.FullTimestamp)}"
    }
}

/** Local midnight of the calendar date a UTC midnight [epochSeconds] names. */
private fun localDateOfUtcDay(
    epochSeconds: Long,
    localDate: (Int, Int, Int) -> Long,
): Long {
    // Days since 1970-01-01 to a proleptic Gregorian date (Hinnant's
    // civil_from_days), so no platform calendar is needed for UTC.
    val z = epochSeconds.floorDiv(86_400L) + 719_468
    val era = z.floorDiv(146_097L)
    val doe = z - era * 146_097
    val yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365
    val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    val mp = (5 * doy + 2) / 153
    val day = (doy - (153 * mp + 2) / 5 + 1).toInt()
    val month = (if (mp < 10) mp + 3 else mp - 9).toInt()
    val year = (yoe + era * 400 + if (month <= 2) 1 else 0).toInt()
    return localDate(year, month, day)
}
