#!/bin/sh
# Keep one Moli instance running in the background; the Node app connects to
# it over CDP on demand (BROWSER_CDP_ENDPOINT) and self-heals on disconnect.
# Node stays the container's main process via exec.
while :; do
    # --block-private-networks is the browser-level SSRF guard; it is
    # deliberately not part of MOLI_FLAGS so it cannot be overridden away
    moli serve --host 127.0.0.1 --port 9222 --block-private-networks $MOLI_FLAGS
    echo "[lens-entrypoint] moli exited ($?), restarting in 1s" >&2
    sleep 1
done &

exec node /app/server/index.mjs
