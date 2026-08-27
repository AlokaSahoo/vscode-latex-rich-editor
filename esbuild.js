const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// MathLive resolves its font files relative to its own script URL at
// runtime (via document.currentScript), so the KaTeX fonts it needs must
// live in a "fonts" folder next to the bundled webview script.
function copyMathliveFonts() {
  const src = path.join(__dirname, "node_modules", "mathlive", "fonts");
  const dest = path.join(__dirname, "dist", "fonts");
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}

// pdf.js loads its worker as a separate script by URL at runtime, not via
// a JS import, so it must be copied alongside the bundled webview script.
function copyPdfWorker() {
  const src = path.join(__dirname, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
  const dest = path.join(__dirname, "dist", "pdf.worker.min.mjs");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
};

/** @type {import('esbuild').BuildOptions} */
const webviewEditorConfig = {
  entryPoints: ["src/webview-editor/main.ts"],
  bundle: true,
  outfile: "dist/webview-editor.js",
  platform: "browser",
  format: "iife",
  target: "es2022",
  sourcemap: false,
  minify: production,
};

/** @type {import('esbuild').BuildOptions} */
const webviewPreviewConfig = {
  entryPoints: ["src/webview-preview/main.ts"],
  bundle: true,
  outfile: "dist/webview-preview.js",
  platform: "browser",
  format: "iife",
  target: "es2022",
  sourcemap: false,
  minify: production,
};

async function run() {
  const configs = [extensionConfig, webviewEditorConfig, webviewPreviewConfig];
  copyMathliveFonts();
  copyPdfWorker();
  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("watching...");
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    console.log("build complete");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
