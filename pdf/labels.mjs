#!/usr/bin/env node
// Usage: node labels.mjs path/to/labels.json
import { buildLabels } from "./labels-lib.mjs";
import { ConfigError } from "./lib.mjs";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: node labels.mjs path/to/labels.json");
  process.exit(1);
}
try {
  await buildLabels(configPath);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err.stack ?? err);
  process.exit(1);
}
