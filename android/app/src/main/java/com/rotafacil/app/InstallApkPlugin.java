package com.rotafacil.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Auto-update fora da Play Store: baixa a .apk publicada no repo e abre o
 * instalador nativo do Android. O Android sempre mostra a tela de
 * confirmação de instalação — não tem como pular esse passo pra um app
 * comum (não é o dono do dispositivo).
 */
@CapacitorPlugin(name = "InstallApk")
public class InstallApkPlugin extends Plugin {

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url é obrigatório");
            return;
        }
        new Thread(() -> {
            try {
                File out = new File(getContext().getCacheDir(), "rotafacil-update.apk");
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.connect();
                int code = conn.getResponseCode();
                if (code != 200) throw new Exception("HTTP " + code);
                try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) fos.write(buf, 0, n);
                }
                installFile(out, call);
            } catch (Exception e) {
                call.reject("Falha ao baixar a atualização: " + e.getMessage(), e);
            }
        }).start();
    }

    private void installFile(File apk, PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            JSObject ret = new JSObject();
            ret.put("status", "needs_permission");
            call.resolve(ret);
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("status", "launched");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Não consegui abrir o instalador: " + e.getMessage(), e);
        }
    }
}
