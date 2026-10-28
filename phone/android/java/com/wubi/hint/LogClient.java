package com.wubi.hint;

import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;

/** 把网页 console 输出转到 logcat，方便真机排查。 */
class LogClient extends WebChromeClient {

    private static final String TAG = "WubiHint";

    @Override
    public boolean onConsoleMessage(ConsoleMessage cm) {
        if (cm != null) {
            Log.i(TAG, "[console] " + cm.message()
                    + " @" + cm.sourceId() + ":" + cm.lineNumber());
        }
        return true;
    }
}
