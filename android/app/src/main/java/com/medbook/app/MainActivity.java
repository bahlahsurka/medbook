package com.medbook.app;

import android.os.Bundle;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // DetailView.js (and AddEntry's editor) implement their OWN text-
    // selection UI — a floating colour-picker bar for highlighting notes,
    // built entirely on window.getSelection()/selectionchange, with its own
    // "tap a colour" affordance. Without this override, Android's native
    // "Copy / Select all / Share / Manage apps" text-selection toolbar ALSO
    // pops up on that same long-press selection and visually fights the
    // app's own bar for the same screen space — tolerable in a mobile
    // browser tab (where system selection chrome is the expected baseline),
    // but reads as flatly broken inside the native app, where nothing else
    // ever shows browser chrome.
    //
    // Returning false from onCreateActionMode tells Android not to start
    // the action mode at all, so the floating toolbar itself never appears
    // — but text selection (drag handles included) is WebView-internal
    // state independent of that toolbar UI, so it's untouched: long-press-
    // and-drag to select still works exactly as before, and so does every
    // bit of JS built on window.getSelection() (the highlight bar's own
    // mechanism, and plain browser text selection elsewhere in the app).
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ActionMode.Callback suppressSelectionToolbar = new ActionMode.Callback() {
            @Override
            public boolean onCreateActionMode(ActionMode mode, Menu menu) {
                return false;
            }

            @Override
            public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
                return false;
            }

            @Override
            public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
                return false;
            }

            @Override
            public void onDestroyActionMode(ActionMode mode) {}
        };

        WebView webView = this.bridge.getWebView();
        // Covers dragging over existing text (what the screenshot shows).
        webView.setCustomSelectionActionModeCallback(suppressSelectionToolbar);
        // Covers tapping an insertion point inside editable content (the
        // notes textarea in edit mode) — same fix, same reasoning.
        webView.setCustomInsertionActionModeCallback(suppressSelectionToolbar);

        // "server.url" mode (capacitor.config.ts) means the SAME production
        // JS/CSS bundle runs here as in a plain mobile browser tab — nothing
        // about the app's own animation/transition code differs between the
        // two. What differs is the renderer itself: Android's embedded
        // System WebView component doesn't turn on every smoothness
        // optimization a full standalone Chrome app does by default, even
        // though both are Blink under the hood. These two are the standard,
        // well-documented, near-zero-risk settings for closing that gap —
        // real fixes for a real category of "WebView feels choppier than
        // the same site in a real browser" reports, not a guess:
        //
        //  - Explicit hardware-accelerated compositing for this WebView.
        //    android:hardwareAccelerated already defaults to true app-wide
        //    (minSdk 24 is well past the API 14 cutover), so this shouldn't
        //    change anything on a normal device — it's here as a guard
        //    against any OEM WebView build that silently ships otherwise.
        //  - setOffscreenPreRaster(true): pre-rasterizes content just
        //    outside the visible viewport instead of only what's on-screen
        //    this frame, at some extra memory cost. This is exactly the
        //    kind of thing a full Chrome tab already effectively does and
        //    a bare embedded WebView does not unless asked — a very
        //    plausible, well-targeted explanation for scrolling/animation
        //    specifically feeling less smooth here than in a browser tab.
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        WebSettings settings = webView.getSettings();
        settings.setOffscreenPreRaster(true);
    }
}
