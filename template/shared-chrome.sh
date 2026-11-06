# Sourced by render.sh and snap.sh, from the video's folder: every video renders with the same headless Chrome.
# Remotion downloads its own into each video (node_modules/.remotion, ≈450 MB), and macOS asks for permission again
# for each new copy; with one shared copy it's downloaded, and asked about, once.
case "$(uname)" in Darwin | Linux)
  c=${REEL_REMOTION_CACHE:-$HOME/.cache/reel-studio/remotion}
  if [ -d node_modules ] && [ ! -L node_modules/.remotion ]; then
    mkdir -p "$c"
    # A video that already downloaded one hands it over when the shared folder has none yet.
    if [ -d node_modules/.remotion/chrome-headless-shell ] && [ ! -e "$c/chrome-headless-shell" ]; then mv node_modules/.remotion/chrome-headless-shell "$c/"; fi
    rm -rf node_modules/.remotion
    ln -s "$c" node_modules/.remotion
  fi
  ;;
esac
