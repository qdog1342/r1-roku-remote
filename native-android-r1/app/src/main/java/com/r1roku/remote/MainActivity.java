package com.r1roku.remote;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {
    private static final String PREFS = "r1_roku_remote";
    private static final String PREF_IP = "roku_ip";
    private static final int ORANGE = Color.rgb(254, 80, 0);
    private static final int GREEN = Color.rgb(0, 166, 125);
    private static final int DARK = Color.rgb(7, 8, 9);
    private static final int PANEL = Color.rgb(25, 27, 29);

    private final ExecutorService io = Executors.newFixedThreadPool(6);
    private final List<RokuDevice> devices = new ArrayList<>();

    private SharedPreferences prefs;
    private TextView status;
    private TextView selectedDevice;
    private EditText ipInput;
    private LinearLayout deviceList;
    private String currentIp = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        currentIp = prefs.getString(PREF_IP, "");
        setContentView(buildUi());
        updateSelected();
        if (!currentIp.isEmpty()) {
            setStatus("Ready: " + currentIp);
        } else {
            discover();
        }
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        super.onDestroy();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() != KeyEvent.ACTION_DOWN) {
            return super.dispatchKeyEvent(event);
        }
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_UP:
                sendKey("Up");
                return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                sendKey("Down");
                return true;
            case KeyEvent.KEYCODE_VOLUME_UP:
                sendKey("VolumeUp");
                return true;
            case KeyEvent.KEYCODE_VOLUME_DOWN:
                sendKey("VolumeDown");
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                sendKey("Left");
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                sendKey("Right");
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                sendKey("Select");
                return true;
            case KeyEvent.KEYCODE_BACK:
                sendKey("Back");
                return true;
            default:
                return super.dispatchKeyEvent(event);
        }
    }

    private View buildUi() {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(false);
        scrollView.setBackgroundColor(DARK);

        LinearLayout root = column();
        root.setPadding(dp(8), dp(7), dp(8), dp(8));
        scrollView.addView(root);

        TextView title = label("R1 Roku", 20, ORANGE, true);
        title.setGravity(Gravity.CENTER);
        root.addView(title, fullWrap());

        selectedDevice = label("", 12, Color.WHITE, false);
        selectedDevice.setGravity(Gravity.CENTER);
        selectedDevice.setPadding(0, dp(2), 0, dp(5));
        root.addView(selectedDevice, fullWrap());

        LinearLayout manual = row();
        ipInput = new EditText(this);
        ipInput.setSingleLine(true);
        ipInput.setTextColor(Color.WHITE);
        ipInput.setTextSize(12);
        ipInput.setHint("Roku IP");
        ipInput.setHintTextColor(Color.GRAY);
        ipInput.setInputType(InputType.TYPE_CLASS_PHONE);
        ipInput.setText(currentIp);
        ipInput.setPadding(dp(8), 0, dp(8), 0);
        ipInput.setBackgroundColor(PANEL);
        manual.addView(ipInput, new LinearLayout.LayoutParams(0, dp(38), 1));
        manual.addView(button("SET", GREEN, v -> selectIp(ipInput.getText().toString())), new LinearLayout.LayoutParams(dp(54), dp(38)));
        root.addView(manual, fullWrap());

        LinearLayout tools = row();
        tools.addView(button("DISCOVER", ORANGE, v -> discover()), weightButton());
        tools.addView(button("TEST", GREEN, v -> sendKey("Home")), weightButton());
        root.addView(tools, fullWrap());

        deviceList = column();
        root.addView(deviceList, fullWrap());

        root.addView(remotePad(), fullWrap());
        root.addView(mediaRow(), fullWrap());
        root.addView(tvRow(), fullWrap());
        root.addView(extraRow(), fullWrap());

        status = label("No Roku selected", 11, Color.LTGRAY, false);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, dp(4), 0, 0);
        root.addView(status, fullWrap());

        return scrollView;
    }

    private LinearLayout remotePad() {
        LinearLayout wrap = column();
        wrap.setPadding(0, dp(6), 0, 0);

        wrap.addView(centeredButton("UP", "Up"), fullWrap());

        LinearLayout middle = row();
        middle.addView(commandButton("LEFT", "Left"), weightButton());
        middle.addView(commandButton("OK", "Select"), weightButton());
        middle.addView(commandButton("RIGHT", "Right"), weightButton());
        wrap.addView(middle, fullWrap());

        wrap.addView(centeredButton("DOWN", "Down"), fullWrap());
        return wrap;
    }

    private LinearLayout mediaRow() {
        LinearLayout row = row();
        row.addView(commandButton("REV", "Rev"), weightButton());
        row.addView(commandButton("PLAY", "Play"), weightButton());
        row.addView(commandButton("FWD", "Fwd"), weightButton());
        return row;
    }

    private LinearLayout tvRow() {
        LinearLayout row = row();
        row.addView(commandButton("VOL-", "VolumeDown"), weightButton());
        row.addView(commandButton("MUTE", "VolumeMute"), weightButton());
        row.addView(commandButton("VOL+", "VolumeUp"), weightButton());
        return row;
    }

    private LinearLayout extraRow() {
        LinearLayout row = row();
        row.addView(commandButton("HOME", "Home"), weightButton());
        row.addView(commandButton("BACK", "Back"), weightButton());
        row.addView(commandButton("PWR", "PowerOff"), weightButton());
        return row;
    }

    private Button centeredButton(String text, String key) {
        Button button = commandButton(text, key);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(74), dp(42));
        params.gravity = Gravity.CENTER_HORIZONTAL;
        params.setMargins(dp(3), dp(3), dp(3), dp(3));
        button.setLayoutParams(params);
        return button;
    }

    private Button commandButton(String text, String key) {
        return button(text, PANEL, v -> sendKey(key));
    }

    private Button button(String text, int color, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(11);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setBackgroundColor(color);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setOnClickListener(listener);
        return button;
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private LinearLayout row() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setGravity(Gravity.CENTER);
        return layout;
    }

    private TextView label(String text, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(color);
        if (bold) {
            view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        }
        return view;
    }

    private LinearLayout.LayoutParams fullWrap() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, dp(2), 0, dp(2));
        return params;
    }

    private LinearLayout.LayoutParams weightButton() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(40), 1);
        params.setMargins(dp(3), dp(3), dp(3), dp(3));
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void selectIp(String rawIp) {
        String ip = rawIp.trim();
        if (ip.startsWith("http://")) {
            ip = ip.substring(7);
        }
        if (ip.contains(":")) {
            ip = ip.substring(0, ip.indexOf(":"));
        }
        if (ip.isEmpty()) {
            setStatus("Enter a Roku IP");
            return;
        }
        currentIp = ip;
        prefs.edit().putString(PREF_IP, currentIp).apply();
        ipInput.setText(currentIp);
        updateSelected();
        setStatus("Selected " + currentIp);
    }

    private void updateSelected() {
        String label = currentIp.isEmpty() ? "No device" : "Device " + currentIp;
        selectedDevice.setText(label);
    }

    private void discover() {
        setStatus("Discovering Roku devices...");
        deviceList.removeAllViews();
        devices.clear();
        io.execute(() -> {
            Map<String, RokuDevice> found = new LinkedHashMap<>();
            discoverBySsdp(found);
            if (found.isEmpty()) {
                scanLocalSubnet(found);
            }
            runOnUiThread(() -> showDevices(new ArrayList<>(found.values())));
        });
    }

    private void discoverBySsdp(Map<String, RokuDevice> found) {
        WifiManager.MulticastLock lock = null;
        try {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                lock = wifi.createMulticastLock("r1-roku-discovery");
                lock.setReferenceCounted(false);
                lock.acquire();
            }

            String search = "M-SEARCH * HTTP/1.1\r\n"
                    + "HOST: 239.255.255.250:1900\r\n"
                    + "MAN: \"ssdp:discover\"\r\n"
                    + "MX: 2\r\n"
                    + "ST: roku:ecp\r\n\r\n";
            byte[] payload = search.getBytes(StandardCharsets.UTF_8);
            InetAddress group = InetAddress.getByName("239.255.255.250");

            try (DatagramSocket socket = new DatagramSocket()) {
                socket.setReuseAddress(true);
                socket.setSoTimeout(900);
                DatagramPacket packet = new DatagramPacket(payload, payload.length, group, 1900);
                socket.send(packet);
                socket.send(packet);

                long end = System.currentTimeMillis() + 2600;
                while (System.currentTimeMillis() < end) {
                    byte[] buffer = new byte[2048];
                    DatagramPacket response = new DatagramPacket(buffer, buffer.length);
                    try {
                        socket.receive(response);
                    } catch (SocketTimeoutException timeout) {
                        continue;
                    }
                    String text = new String(response.getData(), 0, response.getLength(), StandardCharsets.UTF_8);
                    String location = header(text, "LOCATION");
                    String ip = ipFromLocation(location);
                    if (!ip.isEmpty() && !found.containsKey(ip)) {
                        RokuDevice device = queryDevice(ip);
                        found.put(ip, device != null ? device : new RokuDevice(ip, "Roku", ""));
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (lock != null && lock.isHeld()) {
                lock.release();
            }
        }
    }

    private void scanLocalSubnet(Map<String, RokuDevice> found) {
        String saved = currentIp;
        String prefix = "";
        int lastDot = saved.lastIndexOf('.');
        if (lastDot > 0) {
            prefix = saved.substring(0, lastDot + 1);
        }
        if (prefix.isEmpty()) {
            return;
        }
        ExecutorService scanPool = Executors.newFixedThreadPool(32);
        CountDownLatch done = new CountDownLatch(254);
        for (int i = 1; i < 255; i++) {
            final String ip = prefix + i;
            scanPool.execute(() -> {
                try {
                    synchronized (found) {
                        if (found.containsKey(ip)) {
                            return;
                        }
                    }
                    RokuDevice device = queryDevice(ip);
                    if (device != null) {
                        synchronized (found) {
                            found.put(ip, device);
                        }
                    }
                } finally {
                    done.countDown();
                }
            });
        }
        try {
            done.await(8, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } finally {
            scanPool.shutdownNow();
        }
    }

    private void showDevices(List<RokuDevice> found) {
        devices.clear();
        devices.addAll(found);
        deviceList.removeAllViews();
        if (devices.isEmpty()) {
            setStatus("No devices found. Enter IP manually.");
            return;
        }
        setStatus("Found " + devices.size() + " Roku device(s)");
        for (RokuDevice device : devices) {
            Button row = button(device.name + "  " + device.ip, PANEL, v -> selectIp(device.ip));
            deviceList.addView(row, fullWrap());
        }
        if (currentIp.isEmpty()) {
            selectIp(devices.get(0).ip);
        }
    }

    private RokuDevice queryDevice(String ip) {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL("http://" + ip + ":8060/query/device-info").openConnection();
            connection.setConnectTimeout(450);
            connection.setReadTimeout(850);
            connection.setRequestMethod("GET");
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) {
                return null;
            }
            String xml = readAll(connection.getInputStream());
            String name = firstNonEmpty(
                    tag(xml, "user-device-name"),
                    tag(xml, "friendly-device-name"),
                    tag(xml, "model-name"),
                    "Roku"
            );
            String model = firstNonEmpty(tag(xml, "model-name"), tag(xml, "model-number"), "");
            return new RokuDevice(ip, name, model);
        } catch (Exception ignored) {
            return null;
        }
    }

    private void sendKey(String key) {
        if (currentIp.isEmpty()) {
            setStatus("Select or enter a Roku IP first");
            return;
        }
        String ip = currentIp;
        setStatus("Sending " + key);
        io.execute(() -> {
            boolean ok = postKey(ip, key);
            runOnUiThread(() -> setStatus(ok ? "Sent " + key : "Failed " + key + " to " + ip));
        });
    }

    private boolean postKey(String ip, String key) {
        try {
            String encoded = URLEncoder.encode(key, "UTF-8").replace("+", "%20");
            HttpURLConnection connection = (HttpURLConnection) new URL("http://" + ip + ":8060/keypress/" + encoded).openConnection();
            connection.setConnectTimeout(850);
            connection.setReadTimeout(850);
            connection.setDoOutput(true);
            connection.setRequestMethod("POST");
            connection.getOutputStream().write(new byte[0]);
            int code = connection.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void setStatus(String text) {
        status.setText(text);
    }

    private static String readAll(InputStream stream) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        int read;
        while ((read = stream.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        return out.toString("UTF-8");
    }

    private static String header(String response, String name) {
        BufferedReader reader = new BufferedReader(new InputStreamReader(
                new java.io.ByteArrayInputStream(response.getBytes(StandardCharsets.UTF_8)),
                StandardCharsets.UTF_8
        ));
        String line;
        String prefix = name.toLowerCase(Locale.US) + ":";
        try {
            while ((line = reader.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.toLowerCase(Locale.US).startsWith(prefix)) {
                    return trimmed.substring(trimmed.indexOf(':') + 1).trim();
                }
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    private static String ipFromLocation(String location) {
        try {
            if (location == null || location.isEmpty()) {
                return "";
            }
            URI uri = URI.create(location);
            return uri.getHost() == null ? "" : uri.getHost();
        } catch (Exception ignored) {
            return "";
        }
    }

    private static String tag(String xml, String name) {
        String open = "<" + name + ">";
        String close = "</" + name + ">";
        int start = xml.indexOf(open);
        int end = xml.indexOf(close);
        if (start < 0 || end < 0 || end <= start) {
            return "";
        }
        return xml.substring(start + open.length(), end).trim();
    }

    private static String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return "";
    }

    private static class RokuDevice {
        final String ip;
        final String name;
        final String model;

        RokuDevice(String ip, String name, String model) {
            this.ip = ip;
            this.name = name;
            this.model = model;
        }
    }
}
