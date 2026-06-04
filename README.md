# R1 Roku Remote

Roku remote control for the Rabbit R1 form factor.

This repo contains two ways to run it:

- `native-android-r1/`: standalone Android APK project for R1 devices running Android/RabbitOS paths that allow APK install. This is the full version: SSDP discovery, device query, and ECP keypresses.
- `web-creation/`: hosted Rabbit R1 Creation for QR installation. Browser security prevents full Roku SSDP/CORS discovery, so it supports manual IP control directly and optional discovery through the included LAN bridge.

## Why Two Versions?

Roku remotes use Roku ECP on local port `8060`. Native Android can use UDP multicast SSDP and direct HTTP freely, which gives the same network behavior as Android Roku remote apps.

R1 Creations run in a small WebView. A WebView can send `no-cors` keypress requests, but it cannot perform SSDP multicast or read Roku XML responses unless a bridge adds CORS headers. The Creation version is still useful once the Roku IP is known.

## Roku Setup

On Roku OS 14.1+ you may need:

`Settings > System > Advanced system settings > Control by mobile apps > Enabled`

## Native Android Build

Open `native-android-r1/` in Android Studio, or build with:

```sh
cd native-android-r1
./gradlew assembleDebug
```

The local machine currently needs a JDK and Android SDK installed before this command can run.

## Web Creation

Serve the folder:

```sh
cd web-creation
python3 -m http.server 8080
```

Then make an R1 Creation QR with:

```sh
open "tools/r1-creation-qr.html?url=http://YOUR-LAN-IP:8080/&title=R1%20Roku%20Remote"
```

For the optional bridge:

```sh
cd web-creation/bridge
npm install
npm start
```

Then enter `http://YOUR-LAN-IP:8787` as the bridge URL inside the Creation.

