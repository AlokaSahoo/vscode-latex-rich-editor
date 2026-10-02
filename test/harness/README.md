# Webview harness

Runs the built rich editor (`dist/webview-editor.js`) in a normal browser with a fake
`acquireVsCodeApi`, so equation clicks, mode switching and macro rendering can be
checked without launching VS Code.

```sh
npm run build
npm run harness     # then open http://localhost:8765/test/harness/index.html
```

`window.sent` collects every message the webview posts to the host; post a
`{type: "update", text}` message to the window to load other LaTeX.
