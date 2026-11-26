// Build script: bundles src/main.ts into a single main.js and puts it,
// along with manifest.json and styles.css, where Obsidian looks for plugins
// inside TestVault.
//
//   npm run build   -> type-check, then build once
//   npm run dev     -> rebuild automatically every time you save a file

import esbuild from "esbuild";
import { builtinModules } from "module";
import { copyFileSync, mkdirSync, writeFileSync } from "fs";

const watch = process.argv.includes("--watch");
const outDir = "TestVault/.obsidian/plugins/curious";

mkdirSync(outDir, { recursive: true });

// Small esbuild plugin: after every build, copy the two non-code files over.
const copyStaticFiles = {
  name: "copy-static-files",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      copyFileSync("manifest.json", `${outDir}/manifest.json`);
      copyFileSync("styles.css", `${outDir}/styles.css`);
      // Tells the plugin to reload itself when main.js changes (dev only).
      writeFileSync(`${outDir}/.hotreload`, "");
      console.log(`built -> ${outDir}`);
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  outfile: `${outDir}/main.js`,
  bundle: true,
  // Obsidian (and Node, which it runs on) provide these at runtime, so don't
  // bundle copies of them.
  external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view", ...builtinModules],
  // Obsidian loads plugins as CommonJS modules.
  format: "cjs",
  target: "es2020",
  sourcemap: watch ? "inline" : false,
  plugins: [copyStaticFiles],
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
