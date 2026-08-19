package com.rotafacil.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InstallApkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
