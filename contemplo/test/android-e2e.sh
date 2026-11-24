#!/bin/bash
# Runs inside the emulator step of .github/workflows/contemplo-apk.yml (repo root as working directory).
cd contemplo
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell appops set mx.contemplo.studio SYSTEM_ALERT_WINDOW allow || true
adb shell svc power stayon true || true
adb shell am start -n mx.contemplo.studio/.MainActivity
adb forward tcp:18320 tcp:8320
status=0
node test/android-e2e.mjs || status=$?
adb logcat -d > shots/logcat.txt 2>/dev/null || true
grep -E "contemplo|ExoPlayer|MediaCodec|AndroidRuntime" shots/logcat.txt | tail -80 || true
# Small previews in the log, readable without downloading the artifact.
for f in shots/*.png; do echo "SHOT $(basename $f) $(convert "$f" -resize 320x -quality 60 jpg:- | base64 -w0)"; done
exit $status
