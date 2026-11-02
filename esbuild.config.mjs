// Build → main.js (PROF-TS-02). obsidian/electron und die CodeMirror-/Lezer-Module sind extern (vom Host bereitgestellt;
// eine gebündelte zweite Kopie bricht CodeMirror).
import esbuild from "esbuild";

const prod = process.argv.includes("--production");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    "node:*",
  ],
  format: "cjs",
  target: "es2022",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
  console.log("esbuild: watching…");
}
