# Benchmarks

Used for the performance work in the changelog. Needs Microsoft Edge or Chrome and Node 22+.

```sh
npm run build
node bench/gen.mjs 100 > bench/large.tex     # ~2,000 lines; 400 sections gives ~7,800 lines
node bench/gen.mjs 400 > bench/huge.tex
npm run harness &                             # serves the repo on :8765
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless=new --remote-debugging-port=9333 about:blank &

node bench/cdp.mjs bench/huge.tex             # cursor move / keystroke / scroll, Visual vs Source
node bench/profile.mjs bench/huge.tex visual  # CPU profile: top functions by self time
node bench/startup.mjs bench/large.tex        # time to first rendered line

npx esbuild bench/host.ts --bundle --platform=node --outfile=bench/host.js && node bench/host.js   # outline, labels, word count
```

Timings are in milliseconds: `*Sync` is the editor's own work for one change; the other figure also includes layout and is floored by the 16 ms frame.
