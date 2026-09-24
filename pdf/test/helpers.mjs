import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// The fixture's single commit is dated this day, so "Updated" dates are predictable.
export const COMMIT_DATE = "2024-01-02";

// Copies a fixture into a temporary git repo with one commit on COMMIT_DATE.
// `edit` can change files before the commit, e.g. to break an image link.
export function makeProduct(name = "sample-product", edit = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), `docs-tools-${name}-`));
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  edit(dir);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_AUTHOR_DATE: `${COMMIT_DATE}T12:00:00Z`, GIT_COMMITTER_DATE: `${COMMIT_DATE}T12:00:00Z`,
  };
  const git = (...args) => execFileSync("git", args, { cwd: dir, env, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Fixture");
  return { dir, config: join(dir, "docs/pdf/config.json") };
}

export function editJson(file, change) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  change(data);
  writeFileSync(file, JSON.stringify(data, null, 2));
}

// Text of each page, plus every link target, via pdf.js.
export async function readPdf(file) {
  const task = getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 });
  const pdf = await task.promise;
  const pages = [];
  const links = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" ").replace(/\s+/g, " "));
    for (const a of await page.getAnnotations()) if (a.url) links.push(a.url);
  }
  await task.destroy();
  return { pages, text: pages.join("\n"), links };
}

export const silent = { log: () => {} };
