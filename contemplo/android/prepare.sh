#!/bin/sh
# Copies the show-control page from the Worker's public/ into the APK, so the TV serves the exact same page offline.
set -e
cd "$(dirname "$0")"
mkdir -p app/src/main/assets/web
cp ../public/show.html ../public/show.js ../public/common.js ../public/style.css app/src/main/assets/web/
