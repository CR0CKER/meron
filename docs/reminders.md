# Calendar and task reminders

Meron delivers local notifications for calendar events and incomplete tasks:

- Timed calendar events: 10 minutes before each occurrence.
- All-day calendar events and tasks with only a due date: 9 a.m. local time.
- Tasks with a due time: at the selected time, including midnight.

Set an optional task time next to its due date in the task editor. Clearing the
time keeps the date. Timed tasks become overdue as soon as their time passes;
date-only tasks become overdue on the following day. Time information survives
backup export/import and undo.

Repeating calendar events use the same occurrence expansion as the calendar.
Completing or deleting an item, removing its date, or changing its schedule
updates the reminder plan. All platforms remember delivered reminders across
restarts. Catch-up covers up to a day after activation, skips finished events,
and skips schedules set after their reminder time. Editing titles or notes
keeps an existing reminder eligible. First use and enabling notifications start
with upcoming reminders, without replaying old items. Events created or rescheduled less than
10 minutes before starting alert at their start.

Desktop checks every 30 seconds while Meron is running, including in the tray.
Android schedules a local alarm independently of mail push and networking,
revalidates items before delivery, and restores alarms after reboot or timezone
changes. Android may delay alarms to save battery. The Reminders notification
channel can be muted separately from mail.

iOS schedules up to 64 reminders within 30 days using local notifications.
The plan refreshes on launch, foregrounding, changes, mail sync, and background
refresh. Scheduled reminders can fire while the app is suspended; later
occurrences need another refresh to enter that rolling window.

Mobile delivery requires notification permission. Clicking a reminder opens
Meron. Task times are stored as instants; date-only reminders use local 9 a.m.
