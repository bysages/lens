#!/bin/sh
# Keep one Moli instance running in the background; the Node app connects to
# it over CDP on demand (BROWSER_CDP_ENDPOINT) and self-heals on disconnect.
# Node stays the container's main process via exec.
while true; do
    moli serve --host 127.0.0.1 --port 9222 $MOLI_FLAGS
    sleep 1
done &

exec node /app/server/index.mjs
