package com.StudyDesk.app;

// v1.22 (StudyDesk#246) — redraw the widgets when the day changes.
//
// The widgets used to show the "Today" / "Tomorrow" words and the urgency dot
// the app computed when it last pushed, so a student who did not open the app
// kept seeing "Tomorrow" on an item that was now overdue. The snapshot now
// carries each item's due date and WidgetSnapshot works the label out when it
// draws; this receiver makes sure a draw happens just after each local
// midnight. One inexact alarm, rescheduled at every redraw: no exact-alarm
// permission, at most one wakeup a day, and only while a widget has drawn.

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.Calendar;

public class WidgetMidnight extends BroadcastReceiver {

    static final String ACTION = "com.StudyDesk.app.WIDGET_MIDNIGHT";

    @Override
    public void onReceive(Context context, Intent intent) {
        NextUpWidget.refreshAll(context);
        UpcomingWidget.refreshAll(context);
    }

    /** Set (or move) the one alarm to a minute past the next local midnight. */
    static void schedule(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Calendar next = Calendar.getInstance();
        next.add(Calendar.DAY_OF_YEAR, 1);
        next.set(Calendar.HOUR_OF_DAY, 0);
        next.set(Calendar.MINUTE, 1);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        Intent i = new Intent(context, WidgetMidnight.class).setAction(ACTION);
        PendingIntent pi = PendingIntent.getBroadcast(context, 0, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.set(AlarmManager.RTC, next.getTimeInMillis(), pi);
    }
}
