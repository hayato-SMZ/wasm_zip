import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
export default defineConfig({
  plugins: [wasm()],
  server: {
    headers: {
      // Required for SharedArrayBuffer support (zero-copy staging path).
      // See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    fs: {
      // Allow serving files from the pkg/ directory outside the demo root.
      allow: [".."],
    },
  },
});
