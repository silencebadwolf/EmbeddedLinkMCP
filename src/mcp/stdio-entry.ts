/** Compatibility executable for agent commands installed before the monorepo migration. */
await import(new URL('../../../apps/desktop/dist/main/stdio-entry.js', import.meta.url).href);
export {};
