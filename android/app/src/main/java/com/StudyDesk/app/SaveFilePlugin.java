package com.StudyDesk.app;

// v1.21.1 (limecore#103) - save a file where the user picks.
//
// The data export built a blob and clicked an <a download>. In the Android
// WebView nothing handles that download, so nothing was written and the app
// still said "Saved". This opens the system "create document" picker
// (ACTION_CREATE_DOCUMENT) and writes the text to the Uri it returns: the user
// chooses the folder, no storage permission is needed, and no dependency is
// added (the F-Droid recipe and the reproducible build are untouched).
//
// save({ name, data, mimeType? }) resolves { saved: true } once written,
// { saved: false } when the picker is cancelled, and rejects on a write error.

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        if (name == null || name.isEmpty() || data == null) {
            call.reject("name and data are required.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/json"));
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "onPicked");
    }

    @ActivityCallback
    private void onPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent picked = result.getData();
        Uri uri = picked != null ? picked.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("saved", false);
            call.resolve(cancelled);
            return;
        }
        String data = call.getString("data", "");
        new Thread(() -> {
            // StudyDesk#319: the picker has already created an EMPTY file. The
            // write is streamed in chunks (no second full copy via getBytes),
            // and ANY failure, including OutOfMemoryError (an Error, which the
            // old catch (Exception) let kill the thread silently), removes that
            // empty file and rejects, so the app says it failed instead of
            // leaving a blank export behind.
            boolean ok = false;
            try (OutputStream raw = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (raw == null) throw new java.io.IOException("No output stream.");
                java.io.Writer out = new java.io.BufferedWriter(new java.io.OutputStreamWriter(raw, StandardCharsets.UTF_8), 64 * 1024);
                int step = 64 * 1024;
                for (int i = 0; i < data.length(); i += step) {
                    out.write(data, i, Math.min(step, data.length() - i));
                }
                out.flush();
                ok = true;
            } catch (Throwable e) {
                ok = false;
            }
            if (ok) {
                JSObject saved = new JSObject();
                saved.put("saved", true);
                call.resolve(saved);
            } else {
                try { android.provider.DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); } catch (Throwable ignored) { }
                call.reject("Could not write the file.");
            }
        }).start();
    }

    // ── StudyDesk#319, second half: pick, then write ─────────────────────
    //
    // save() carried the whole export (megabytes) in the call that waits on
    // the picker. While the picker is open, Capacitor keeps that call in the
    // activity's saved state, and a Bundle over ~1 MB throws
    // TransactionTooLargeException: the app was killed, the picker's result
    // had nowhere to go, and the empty file it had created stayed with no
    // error. pick() carries only the name; write() gets the data afterwards,
    // in a call that never waits on another activity.

    @PluginMethod
    public void pick(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty()) {
            call.reject("name is required.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/json"));
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "onPickedUri");
    }

    @ActivityCallback
    private void onPickedUri(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent picked = result.getData();
        Uri uri = picked != null ? picked.getData() : null;
        JSObject out = new JSObject();
        out.put("uri", result.getResultCode() == Activity.RESULT_OK && uri != null ? uri.toString() : null);
        call.resolve(out);
    }

    @PluginMethod
    public void write(PluginCall call) {
        String uriString = call.getString("uri");
        String data = call.getString("data");
        if (uriString == null || data == null) {
            call.reject("uri and data are required.");
            return;
        }
        Uri uri = Uri.parse(uriString);
        new Thread(() -> {
            boolean ok = false;
            try (OutputStream raw = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (raw == null) throw new java.io.IOException("No output stream.");
                java.io.Writer out = new java.io.BufferedWriter(new java.io.OutputStreamWriter(raw, StandardCharsets.UTF_8), 64 * 1024);
                int step = 64 * 1024;
                for (int i = 0; i < data.length(); i += step) {
                    out.write(data, i, Math.min(step, data.length() - i));
                }
                out.flush();
                ok = true;
            } catch (Throwable e) {
                ok = false;
            }
            if (ok) {
                JSObject saved = new JSObject();
                saved.put("saved", true);
                call.resolve(saved);
            } else {
                try { android.provider.DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); } catch (Throwable ignored) { }
                call.reject("Could not write the file.");
            }
        }).start();
    }
}
