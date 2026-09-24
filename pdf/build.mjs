#!/usr/bin/env node
// Usage: node build.mjs [path/to/config.json]   (default: docs/pdf/config.json)
import { appendFileSync } from "node:fs";
import { relative } from "node:path";
import { buildPdfs, ConfigError } from "./lib.mjs";

const configPath = process.argv[2] ?? "docs/pdf/config.json";
try {
  const written = await buildPdfs(configPath);
  // Inside a GitHub Action, report what was written so a later step can commit it.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `pdfs=${written.map((p) => relative(process.cwd(), p)).join(" ")}\n`);
  }
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err.stack ?? err);
  process.exit(1);
}
