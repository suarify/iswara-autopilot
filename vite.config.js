import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
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
