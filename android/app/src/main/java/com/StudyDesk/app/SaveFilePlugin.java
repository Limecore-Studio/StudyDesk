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
        // Off the main thread: an export can be a few MB, and a cloud
        // provider's stream may block on the network.
        new Thread(() -> {
            try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w")) {
                if (out == null) throw new java.io.IOException("No output stream.");
                out.write(data.getBytes(StandardCharsets.UTF_8));
                out.flush();
                JSObject saved = new JSObject();
                saved.put("saved", true);
                call.resolve(saved);
            } catch (Exception e) {
                call.reject("Could not write the file.");
            }
        }).start();
    }
}
