// Build script: bundles src/main.ts into a single main.js and puts it,
// along with manifest.json and styles.css, where Obsidian looks for plugins
// inside the test vault.
//
//   npm run build   -> type-check, then build once
//   npm run dev     -> rebuild automatically every time you save a file

import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";

const watch = process.argv.includes("--watch");
const outDir = "test-vault/.obsidian/plugins/curious";

mkdirSync(outDir, { recursive: true });

// Small esbuild plugin: after every build, copy the two non-code files over.
const copyStaticFiles = {
  name: "copy-static-files",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      copyFileSync("manifest.json", `${outDir}/manifest.json`);
      copyFileSync("styles.css", `${outDir}/styles.css`);
      console.log(`built -> ${outDir}`);
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  outfile: `${outDir}/main.js`,
  bundle: true,
  // Obsidian provides these itself at runtime, so don't bundle copies of them.
  external: ["obsidian", "electron"],
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
