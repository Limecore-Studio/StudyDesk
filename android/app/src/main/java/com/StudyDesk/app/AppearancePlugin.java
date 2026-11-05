package com.StudyDesk.app;

import android.graphics.Color;
import android.os.Build;
import android.view.Window;

import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.view.WindowCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v1.20 (#208) — puts what Android draws for us in step with StudyDesk's own
 * appearance, which is chosen in the app and is independent of the device's.
 *
 * Two things are themed from the activity, not from CSS, and both followed the
 * DEVICE (the theme is DayNight):
 *
 *  - the WebView's native date and time pickers: a white dialog over a black
 *    app, whatever `color-scheme` says. A local night mode on the AppCompat
 *    delegate fixes those. The manifest declares `uiMode` in configChanges, so
 *    AppCompat applies it as a configuration change rather than recreating the
 *    activity (and the WebView).
 *
 *  - the navigation bar on 3-button navigation. Edge-to-edge does not draw the
 *    WebView behind it, so it shows the window's own ground plus a contrast
 *    scrim the system picks from the device theme: #CACACA under a black app,
 *    measured on an API 37 emulator. Here the ground becomes the app's `--bg`
 *    (passed in), the scrim goes, and the button colour follows the app.
 */
@CapacitorPlugin(name = "Appearance")
public class AppearancePlugin extends Plugin {

    @PluginMethod
    public void setNightMode(PluginCall call) {
        final boolean dark = call.getBoolean("dark", false);
        final String color = call.getString("color", null);
        final int mode = dark ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO;
        final AppCompatActivity activity = getActivity();
        activity.runOnUiThread(() -> {
            // Skipped when unchanged: every theme switch and every launch calls
            // this, and a no-op config change still costs a layout pass.
            if (activity.getDelegate().getLocalNightMode() != mode) {
                activity.getDelegate().setLocalNightMode(mode);
            }

            Window window = activity.getWindow();
            if (color != null) {
                try {
                    int ground = Color.parseColor(color);
                    window.getDecorView().setBackgroundColor(ground);
                    // Android 14 and below draw the bar in this colour; 15+
                    // ignores it under edge-to-edge and shows the ground above.
                    window.setNavigationBarColor(ground);
                } catch (IllegalArgumentException ignored) {
                    // Not a colour Android can parse: leave the theme's.
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.setNavigationBarContrastEnforced(false);
            }
            WindowCompat.getInsetsController(window, window.getDecorView())
                .setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }
}
