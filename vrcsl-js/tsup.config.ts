import { defineConfig } from "tsup";

export default defineConfig([
  // ESM + CJS builds
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    splitting: false,
    clean: true,
    target: "es2020",
    external: ["ws"],
    platform: "neutral",
  },
  // UMD/IIFE build for browsers
  {
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "VRCSL",
    outExtension: () => ({ js: ".global.js" }),
    platform: "browser",
    target: "es2020",
    noExternal: [/.*/],
    minify: true,
  },
]);
