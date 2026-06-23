// We avoid runtime require by reading package.json synchronously.
// Bun's bundler inlines this at build time (bun build ./src/main.ts).
export const VERSION: string = (() => {
  try {
    return require("../../package.json").version;
  } catch {
    return "0.0.0";
  }
})();
