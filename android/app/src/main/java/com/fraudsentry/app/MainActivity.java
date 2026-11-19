package com.fraudsentry.app;

import android.os.Bundle;
import com.fraudsentry.app.background.BackgroundScanPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Phone Protection (background message checks, share / select-text to FraudSentry)
        registerPlugin(BackgroundScanPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
