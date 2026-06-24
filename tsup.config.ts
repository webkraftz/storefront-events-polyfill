import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    auto: "src/auto.ts",
  },
  format: ["esm", "cjs"],
  target: "es2022",
  sourcemap: true,
  dts: {
    resolve: true,
  },
  tsconfig: "./tsconfig.build.json",
  minify: true,
  treeshake: true,
  clean: true,
  splitting: false,
  outDir: "dist",
});
