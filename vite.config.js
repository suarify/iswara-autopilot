import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  server: {
    proxy: {
      // Same-origin relay for the TypeSafe API in dev: the browser calls
      // /typesafe/v1/* on localhost, Vite forwards to api.typesafe.ai with
      // the original method/headers/body, so no CORS preflight is triggered.
      // Production (GitHub Pages) has no dev server — point VITE_JEV_ENDPOINT
      // at the public relay worker (workers/jev-relay.js) for the same effect.
      "/typesafe": {
        target: "https://api.typesafe.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/typesafe/, ""),
      },
    },
  },
  build: {
    rolldownOptions: {
      input: { main: "index.html" },
      output: {
        codeSplitting: {
          groups: [{ name: "three", test: /node_modules\/three/ }],
        },
      },
    },
  },
});
