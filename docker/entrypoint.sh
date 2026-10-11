#!/bin/sh
# Keep one Moli instance running in the background; the Node app connects to
# it over CDP on demand (BROWSER_CDP_ENDPOINT) and self-heals on disconnect.
# Node stays the container's main process via exec.

# Non-root Fontconfig and Moli cache directories must live under /tmp.
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-/tmp/lens-cache}"
mkdir -p "$XDG_CACHE_HOME/fontconfig" "$XDG_CACHE_HOME/moli-http"

# Nitro's traced node_modules layout does not preserve pnpm's sibling-package
# path expected by the RPATH in sharp's native loader. Add the copied libvips
# package explicitly so dlopen can resolve libvips-cpp after the app starts.
case "$(uname -m)" in
    x86_64) sharp_arch=x64 ;;
    aarch64) sharp_arch=arm64 ;;
    *) sharp_arch= ;;
esac
if [ -n "$sharp_arch" ]; then
    sharp_lib="/app/server/node_modules/@img/sharp-libvips-linux-${sharp_arch}/lib"
    if [ -d "$sharp_lib" ]; then
        export LD_LIBRARY_PATH="${sharp_lib}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
    fi
fi

while :; do
    # --block-private-networks is the browser-level SSRF guard; it is
    # deliberately not part of MOLI_FLAGS so it cannot be overridden away
    moli serve --host 127.0.0.1 --port 9222 --block-private-networks $MOLI_FLAGS
    echo "[lens-entrypoint] moli exited ($?), restarting in 1s" >&2
    sleep 1
done &

exec node /app/server/index.mjs
