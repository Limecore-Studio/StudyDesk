package com.StudyDesk.app;

// v1.9 (Item 8) — the data the home-screen widgets draw from.
//
// The widgets cannot read StudyDesk's own data. It lives in IndexedDB inside
// the WebView, which only exists while the app is running; a widget is drawn by
// the launcher process, often with the app long since killed. So the JS layer
// pushes a small snapshot out to SharedPreferences whenever the data changes
// (see WidgetBridgePlugin), and the widgets read only that.
//
// The consequence is worth stating plainly: a widget is as fresh as the last
// time the app was open. For assignments and exams — things with due dates days
// away, edited a few times a week — that is the right trade. The alternative is
// a background service polling Supabase, which costs battery and a foreground
// notification on modern Android to show data that barely moves.
//
// Stored as one JSON string rather than a spread of typed preference keys, so
// adding a field to the snapshot never needs a migration on the native side.

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

final class WidgetSnapshot {

    static final String PREFS = "studydesk_widget";
    static final String KEY_JSON = "snapshot";

    /** One upcoming item: an assignment due, or an exam. */
    static final class Item {
        final String title;
        final String when;
        /** "assignment" | "exam". Carried but not currently drawn. */
        final String kind;
        /** "urgent" | "soon" | "later" — v1.10, picks the dot. */
        final String urgency;

        Item(String title, String when, String kind, String urgency) {
            this.title = title;
            this.when = when;
            this.kind = kind;
            this.urgency = urgency;
        }
    }

    /**
     * Dot for an urgency string.
     *
     * Anything unrecognised falls back to the calm one. A snapshot written by
     * an older app version has no urgency field at all — that happens on every
     * install that updates the APK without reopening the app, and it should
     * look understated rather than alarm the user in red.
     */
    static int dotFor(String urgency) {
        if ("urgent".equals(urgency)) return R.drawable.widget_dot_urgent;
        if ("soon".equals(urgency)) return R.drawable.widget_dot_soon;
        return R.drawable.widget_dot_later;
    }

    /**
     * v1.15 — the widget's colours. Resolved in JS (lib/theme.js
     * resolveWidgetPalette: the app's own look, or the user's override in
     * Settings) and sent as a name, so the rule for which look is active lives
     * in one place. The values are the app's own tokens from modes.css.
     */
    static final class Palette {
        final int paper;   // drawable: page + margin rule
        final int rule;    // drawable: Upcoming row hairline
        final int label;   // NEXT UP / UPCOMING caption
        final int title;   // the item itself
        final int sub;     // course, date, empty state

        Palette(int paper, int rule, int label, int title, int sub) {
            this.paper = paper;
            this.rule = rule;
            this.label = label;
            this.title = title;
            this.sub = sub;
        }
    }

    private static final Palette LIGHT = new Palette(
        R.drawable.widget_paper, R.drawable.widget_row_rule,
        0xFFA8A096, 0xFF1A1814, 0xFF8A8279);
    private static final Palette DARK = new Palette(
        R.drawable.widget_paper_dark, R.drawable.widget_row_rule_dark,
        0xFF938B82, 0xFFEDE7DA, 0xFFA8A096);
    private static final Palette BLACK = new Palette(
        R.drawable.widget_paper_black, R.drawable.widget_row_rule_black,
        0xFF938B82, 0xFFEDE7DA, 0xFFA8A096);

    /**
     * Anything unrecognised is the cream page: that is what every snapshot
     * written before v1.15 means, and what the widget looked like until now.
     */
    static Palette paletteFor(String name) {
        if ("dark".equals(name)) return DARK;
        if ("black".equals(name)) return BLACK;
        return LIGHT;
    }

    final String nextUpTitle;
    final String nextUpSubtitle;
    final String nextUpUrgency;
    final Item[] upcoming;
    final Palette palette;
    /** StudyDesk#258 — Upcoming's empty text, already localised; "" keeps the
     *  layout's own "Nothing due". */
    final String upcomingEmpty;

    private WidgetSnapshot(String nextUpTitle, String nextUpSubtitle, String nextUpUrgency,
                           Item[] upcoming, Palette palette, String upcomingEmpty) {
        this.nextUpTitle = nextUpTitle;
        this.nextUpSubtitle = nextUpSubtitle;
        this.nextUpUrgency = nextUpUrgency;
        this.upcoming = upcoming;
        this.palette = palette;
        this.upcomingEmpty = upcomingEmpty;
    }

    /**
     * Read the last snapshot the app wrote.
     *
     * Never throws and never returns null: a widget that cannot parse its data
     * still has to draw something, and an empty snapshot renders as the
     * "nothing due" state — which is also exactly what a fresh install shows
     * before the app has ever run.
     */
    // v1.22 (StudyDesk#246): the label and dot are worked out when the widget
    // draws, from the item's due date, so they move on with the calendar even
    // when the app is not opened. Mirrors whenLabel / urgencyOf in
    // src/lib/widgetBridge.js. A snapshot from an older app has no dueDate and
    // keeps the words it was given.

    /** Whole local days from today to "YYYY-MM-DD", or null if unreadable. */
    static Integer daysUntil(String iso) {
        if (iso == null || iso.length() < 10) return null;
        try {
            int y = Integer.parseInt(iso.substring(0, 4));
            int m = Integer.parseInt(iso.substring(5, 7));
            int d = Integer.parseInt(iso.substring(8, 10));
            Calendar due = Calendar.getInstance();
            due.clear();
            due.set(y, m - 1, d);
            Calendar now = Calendar.getInstance();
            Calendar today = Calendar.getInstance();
            today.clear();
            today.set(now.get(Calendar.YEAR), now.get(Calendar.MONTH), now.get(Calendar.DAY_OF_MONTH));
            return (int) Math.round((due.getTimeInMillis() - today.getTimeInMillis()) / 86400000.0);
        } catch (Exception e) {
            return null;
        }
    }

    static String urgencyFor(int days) {
        if (days <= 0) return "urgent";
        if (days <= 3) return "soon";
        return "later";
    }

    /** { when, urgency } for an item, or the stored pair when it has no date. */
    private static String[] relabel(JSONObject o, JSONObject words, String when, String urgency) {
        Integer days = o == null ? null : daysUntil(o.optString("dueDate", null));
        if (days == null) return new String[] { when, urgency };
        String w;
        if (days == 0 && words != null) w = words.optString("today", when);
        else if (days == 1 && words != null) w = words.optString("tomorrow", when);
        else w = o.optString("dateText", when);
        return new String[] { w, urgencyFor(days) };
    }

    static WidgetSnapshot load(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_JSON, null);
        if (raw == null) return empty();
        try {
            JSONObject root = new JSONObject(raw);
            JSONObject next = root.optJSONObject("nextUp");
            String title = next == null ? "" : next.optString("title", "");
            String subtitle = next == null ? "" : next.optString("subtitle", "");
            String urgency = next == null ? "later" : next.optString("urgency", "later");
            JSONObject words = root.optJSONObject("words");
            if (next != null && next.has("dueDate")) {
                String[] r = relabel(next, words, "", urgency);
                urgency = r[1];
                String course = next.optString("course", "");
                subtitle = course.length() > 0 ? course + " · " + r[0] : r[0];
            }

            JSONArray arr = root.optJSONArray("upcoming");
            int n = arr == null ? 0 : arr.length();
            Item[] items = new Item[n];
            for (int i = 0; i < n; i++) {
                JSONObject o = arr.optJSONObject(i);
                String[] r = relabel(o, words,
                    o == null ? "" : o.optString("when", ""),
                    o == null ? "later" : o.optString("urgency", "later"));
                items[i] = new Item(
                    o == null ? "" : o.optString("title", ""),
                    r[0],
                    o == null ? "assignment" : o.optString("kind", "assignment"),
                    r[1]
                );
            }
            // optString turns a JSON null into "null"; isNull keeps it empty.
            String upcomingEmpty = root.isNull("upcomingEmpty") ? "" : root.optString("upcomingEmpty", "");
            return new WidgetSnapshot(title, subtitle, urgency, items,
                paletteFor(root.optString("palette", "light")), upcomingEmpty);
        } catch (Exception e) {
            // Corrupt or half-written JSON. Draw the empty state rather than
            // letting the launcher show a crashed-widget placeholder.
            return empty();
        }
    }

    static WidgetSnapshot empty() {
        return new WidgetSnapshot("", "", "later", new Item[0], LIGHT, "");
    }

    boolean hasNextUp() {
        return nextUpTitle != null && nextUpTitle.length() > 0;
    }
}
