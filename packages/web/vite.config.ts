import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [],
  lint: {
    ignorePatterns: ["dist/**"],
  },
  fmt: {
    ignorePatterns: ["dist/**"],
  },
});
