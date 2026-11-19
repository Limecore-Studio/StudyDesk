// The tap-action ID on assignment reminders. Its own module so the startup
// listener (app/useAppEvents.js) can match it without pulling the reminder
// scheduler, which loads on demand (v1.22, limecore#126). Re-exported from
// planNotifications.js, which attaches it to each notification.
export const ACTION_DONE_ID = "done";
