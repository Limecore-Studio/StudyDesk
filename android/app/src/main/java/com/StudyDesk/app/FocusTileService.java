package com.StudyDesk.app;

// limecore#127 — the focus Quick Settings tile: start or pause the focus timer
// from the shade, with the time left shown while it runs.
//
// The timer's state lives in the WebView (`sd-timer`), so the tile cannot run
// the timer itself. The web layer pushes what the tile should show
// (FocusModePlugin.setTile, stored in SharedPreferences), and a tap opens the
// app with the same focus action the chip's buttons use (#289: pause, resume)
// or "start", which JS turns into a new focus block. The time left is worked
// out from the stored end each time the shade opens, so it is right without
// anything ticking.

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

public class FocusTileService extends TileService {

    static final String PREFS = "studydesk_focus_tile";

    @Override
    public void onStartListening() {
        super.onStartListening();
        render();
    }

    private void render() {
        Tile tile = getQsTile();
        if (tile == null) return;
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String state = p.getString("state", "idle");
        long endsAt = p.getLong("endsAt", 0L);
        String sub;
        if ("running".equals(state)) {
            if (endsAt > 0) {
                long mins = Math.max(0, (endsAt - System.currentTimeMillis() + 59_999) / 60_000);
                sub = p.getString("leftText", "{n} min").replace("{n}", String.valueOf(mins));
            } else {
                sub = p.getString("runningText", "");
            }
            tile.setState(Tile.STATE_ACTIVE);
        } else if ("paused".equals(state)) {
            sub = p.getString("pausedText", "");
            tile.setState(Tile.STATE_ACTIVE);
        } else {
            sub = p.getString("idleText", "");
            tile.setState(Tile.STATE_INACTIVE);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.setSubtitle(sub);
        else tile.setContentDescription(sub);
        tile.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        String state = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("state", "idle");
        String action = "running".equals(state) ? "pause" : "paused".equals(state) ? "resume" : "start";
        Runnable open = () -> openApp(action);
        if (isLocked()) unlockAndRun(open);
        else open.run();
    }

    private void openApp(String action) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra(FocusModePlugin.EXTRA_ACTION, action);
        if (Build.VERSION.SDK_INT >= 34) {
            PendingIntent pi = PendingIntent.getActivity(
                    this, 300, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            startActivityAndCollapse(pi);
        } else {
            startActivityAndCollapseLegacy(intent);
        }
    }

    @SuppressWarnings("deprecation")
    private void startActivityAndCollapseLegacy(Intent intent) {
        startActivityAndCollapse(intent);
    }
}
