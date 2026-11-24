# Installing the player on the Google TV Streamer

The app is not in the Play Store. You install it once (sideload); updates install the same way over the old one and
the TV stays paired.

## 0. Prepare the Streamer (once)

1. **Developer mode:** Settings → System → About → scroll to **Android TV OS build** → click it 7 times ("You are now a developer").
2. **Never sleep:** Settings → System → Energy (or Power & energy) → *When inactive* / *Turn off display* → **Never**. Settings → System → Ambient mode / Screen saver → **Off / Never**.
3. **Fixed picture:** Settings → Display & Sound → Advanced display settings → set the resolution the projectors want (e.g. 1080p 60 Hz) and turn **off** *Match content dynamic range* / *frame rate*, so the HDMI signal doesn't renegotiate between videos (that renegotiation is a black gap of 1–3 s on many projectors and splitters).
4. **Fixed address:** in Omada, give the Streamer a DHCP reservation. The live-control address `http://<ip>:8320` then never changes.

## 1. Install (choose A or B)

### A. From the TV alone (Downloader app)

1. Play Store on the TV → install **Downloader** (by AFTVnews).
2. Settings → Apps → Security & restrictions → Unknown sources → allow **Downloader**.
3. Open Downloader, type `contemplo.dos-buhos.workers.dev/tv` → Go. It downloads the newest `contemplo-tv.apk` → **Install** → **Open**.

### B. From the Windows laptop (also enables auto-start after a power cut)

1. Download Google's **SDK Platform-Tools for Windows** (developer.android.com/tools/releases/platform-tools), unzip to `C:\platform-tools`.
2. Download the APK: `https://contemplo.dos-buhos.workers.dev/tv` (saves `contemplo-tv.apk`).
3. On the TV: Settings → System → Developer options → **Wireless debugging** on → *Pair device with pairing code*. It shows an IP:port and a 6-digit code.
4. In PowerShell:
   ```
   cd C:\platform-tools
   .\adb pair 192.168.0.50:37123          # the pairing IP:port and code shown on the TV
   .\adb connect 192.168.0.50:41235       # the IP:port shown on the Wireless debugging screen (different port)
   .\adb install -r $HOME\Downloads\contemplo-tv.apk
   .\adb shell appops set mx.contemplo.studio SYSTEM_ALERT_WINDOW allow
   .\adb shell am start -n mx.contemplo.studio/.MainActivity
   ```
   The `appops` line lets the app bring itself back to the screen after a reboot or power cut (Android blocks this for
   sideloaded apps otherwise). If your build only offers *USB debugging* / *Network debugging* instead of *Wireless
   debugging*, use `.\adb connect <ip>:5555` and skip `adb pair`.

## 2. Pair

The TV shows **CONTEMPLO STUDIO · Pair this device with your dashboard** and a 6-digit code. On the laptop:
apps.dosbuhos.com/contemplo → **Pantallas** → type the code and a name (*Contemplo Main*) → **Vincular**. The TV
switches to "lista para proyectar" within a few seconds. The PIN for live control is shown under Pantallas.

## 3. Verify (10 minutes, before the first event)

1. Upload a short MP4 → **Enviar al TV** → wait for *✓ Listo en el TV* → **Reproducir**. It appears on the projectors.
2. **NEGRO** → projectors show black but keep signal (not "no signal").
3. Unplug the internet (Omada WAN or Starlink). The video keeps looping. On the phone (same Wi-Fi) open `http://<tv-ip>:8320` → PIN → pause, restart, GO another scene. All of it works.
4. Reconnect internet: the dashboard shows the TV *en línea* again within ~5 s.
5. Pull the Streamer's power, plug it back. With step 1B done, Contemplo Studio comes back by itself and resumes the last video. Without it, open it from **Apps** (one click; it resumes).
6. On the live page, check the PROGRAM footer: *GO sin negro* means this Streamer runs two decoders (seamless GO). *GO con corte breve* means it fell back to one, so GO has a cut of about 0.3 s. Test with your real 4K files. If 4K falls back, 1080p versions of the show scenes usually keep dual mode.

## Updating

Same as install (Downloader with the same address, or `adb install -r`). The signature never changes, so data and
pairing are kept. Every push to `main` that touches `contemplo/android/` builds a new release:
github.com/dosbuhos/dosbuhos-ops/releases.

## Known Google TV limits

- **Auto-start:** Google TV only delivers the boot signal to an app that has been opened at least once. Without the `appops` grant it ignores the start. There is no supported way to replace the Google TV home screen without disabling Google's launcher over adb, which we don't do.
- **Notifications:** the app shows nothing over the video, but Android itself can show system pop-ups (e.g. low storage). Keep storage below ~85 % full (Pantallas shows it) and turn off notifications from other apps.
- **Output resolution, projector power, splitter:** not controllable from the app. Set the resolution in Settings (step 0.3). Projector power stays manual.
