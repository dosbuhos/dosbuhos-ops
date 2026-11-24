#!/bin/bash
# Runs inside the emulator step of .github/workflows/contemplo-apk.yml (repo root as working directory).
cd contemplo
mkdir -p shots
adb shell wm size; adb shell settings put global stay_on_while_plugged_in 7 || true
adb shell input keyevent KEYCODE_WAKEUP || true
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell appops set mx.contemplo.studio SYSTEM_ALERT_WINDOW allow || true
adb logcat -c || true
adb shell am start -W -n mx.contemplo.studio/.MainActivity
adb forward tcp:18320 tcp:8320
sleep 5
adb shell dumpsys activity activities | grep -E "ResumedActivity|topResumed" | head -3
status=0
node test/android-e2e.mjs || status=$?
adb logcat -d > shots/logcat.txt 2>/dev/null || true
echo "---- app log ----"; grep -E "Contemplo|ExoPlayer|MediaCodecVideoRenderer|ANR in|FATAL|mx\.contemplo" shots/logcat.txt | grep -v "systemui" | tail -120
adb shell dumpsys activity activities | grep -E "ResumedActivity|topResumed" | head -3
for f in shots/*.png; do echo "SHOT $(basename $f) $(convert "$f" -resize 480x -quality 60 jpg:- | base64 -w0)"; done
exit $status
