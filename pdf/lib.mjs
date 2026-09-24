// Builds product documentation PDFs from Markdown. See README.md for the config format.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Marked } from "marked";
import { gfmHeadingId } from "marked-gfm-heading-id";
import puppeteer from "puppeteer";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const DEFAULTS = {
  brand: "Schenktronics",
  logo: "images/logo-dark.png",
  footer: "schenktronics.com · CC BY-NC-SA 4.0",
  paper: "Letter",
  docsDir: "..",
  outDir: ".",
};

export class ConfigError extends Error {}

// Reads and checks a product's config file. Relative paths in the config are
// resolved against the config file's own folder.
export function loadConfig(configPath) {
  const file = resolve(configPath);
  if (!existsSync(file)) throw new ConfigError(`Config file not found: ${file}`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`Config file is not valid JSON: ${file}\n${err.message}`);
  }
  const config = { ...DEFAULTS, ...raw };
  const problems = [];
  for (const key of ["product", "pcbVersion", "repo", "branch"]) {
    if (typeof config[key] !== "string" || !config[key]) problems.push(`"${key}" is required`);
  }
  if (config.repo && !/^[\w.-]+\/[\w.-]+$/.test(config.repo)) problems.push(`"repo" must look like "owner/name"`);
  if (!Array.isArray(config.documents) || config.documents.length === 0) {
    problems.push(`"documents" must list at least one document`);
  } else {
    config.documents.forEach((doc, i) => {
      for (const key of ["src", "out", "title"]) {
        if (typeof doc[key] !== "string" || !doc[key]) problems.push(`documents[${i}].${key} is required`);
      }
      if (doc.out && !doc.out.endsWith(".pdf")) problems.push(`documents[${i}].out must end in .pdf`);
    });
  }
  if (problems.length) throw new ConfigError(`Problems in ${file}:\n  - ${problems.join("\n  - ")}`);

  // Real paths, because git reports real paths: on macOS /var is a link to
  // /private/var, and mixing the two breaks the link rewriting.
  const base = realpathSync(dirname(file));
  config.configPath = file;
  config.docsDir = resolve(base, config.docsDir);
  config.outDir = resolve(base, config.outDir);
  config.rootDir = gitRoot(config.docsDir) ?? config.docsDir;
  config.blobBase = `https://github.com/${config.repo}/blob/${config.branch}`;
  config.officialUrl ??= `github.com/${config.repo}`;
  for (const doc of config.documents) {
    doc.srcPath = resolve(config.docsDir, doc.src);
    doc.outPath = resolve(config.outDir, doc.out);
    if (!existsSync(doc.srcPath)) problems.push(`Document not found: ${doc.srcPath}`);
  }
  if (problems.length) throw new ConfigError(problems.join("\n"));
  return config;
}

function gitRoot(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
  } catch {
    return null;
  }
}

// The date a file was last committed (YYYY-MM-DD), so rebuilding unchanged docs
// gives the same date. Falls back to today for files git doesn't know about.
export function lastChanged(file) {
  try {
    const date = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], {
      cwd: dirname(file), stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    if (date) return date;
  } catch {}
  return new Date().toISOString().slice(0, 10);
}

// Links to other files in the repo point at GitHub, since the PDF travels on its own.
// Anchors (#…) and absolute URLs are left alone.
export function rewriteLinks(html, { docsDir, rootDir, blobBase }) {
  return html.replace(/href="([^"#:][^":]*)"/g, (_, target) => {
    const repoPath = relative(rootDir, resolve(docsDir, target)).split("\\").join("/");
    return `href="${blobBase}/${repoPath}"`;
  });
}

// Chrome stamps each PDF with the build time, so unchanged docs would still
// produce a new file on every build. Pin the stamps to the doc's "Updated"
// date instead. The replacement is the same length, so the PDF stays valid.
export function pinTimestamps(pdf, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Expected a YYYY-MM-DD date, got "${date}"`);
  const stamp = `D:${date.replaceAll("-", "")}000000`;
  const text = Buffer.from(pdf).toString("latin1")
    .replace(/\/(CreationDate|ModDate) \(D:\d{14}/g, (_, key) => `/${key} (${stamp}`);
  return Buffer.from(text, "latin1");
}

// Chrome tags table header cells for accessibility with IDs taken from its
// internal element numbers, like (node00000030). Those numbers vary slightly
// between runs, so a document with a table could change on every build.
// Renumber them 1, 2, 3… in their original order: the length stays the same
// and the order is kept, which the PDF's sorted ID index relies on.
export function normalizeNodeIds(pdf) {
  const text = Buffer.from(pdf).toString("latin1");
  const ids = [...new Set(text.match(/\(node\d{8}\)/g) ?? [])].sort();
  const renumber = new Map(ids.map((id, i) => [id, `(node${String(i + 1).padStart(8, "0")})`]));
  return Buffer.from(text.replace(/\(node\d{8}\)/g, (id) => renumber.get(id)), "latin1");
}

// Makes the PDF depend only on its content, so unchanged docs rebuild to identical bytes.
export function stabilize(pdf, date) {
  return normalizeNodeIds(pinTimestamps(pdf, date));
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function renderHtml(config, doc, body) {
  const fonts = pathToFileURL(join(dirname(require.resolve("@fontsource/inter/package.json")), "files")).href;
  const css = readFileSync(join(HERE, "style.css"), "utf8").replaceAll("FONT_DIR", fonts);
  const logoPath = config.logo && resolve(config.docsDir, config.logo);
  const brand = logoPath && existsSync(logoPath)
    ? `<img class="brand" src="${pathToFileURL(logoPath).href}" alt="${escapeHtml(config.brand)}">`
    : `<div class="brand-text">${escapeHtml(config.brand)}</div>`;
  const e = escapeHtml;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="${pathToFileURL(config.docsDir).href}/">
<title>${e(config.product)} ${e(doc.title)}</title>
<style>${css}</style>
</head>
<body>
<header class="cover">
  ${brand}
  <h1>${e(config.product)}</h1>
  <div class="doc-title">${e(doc.title)}</div>
  <div class="meta">For PCB ${e(config.pcbVersion)} · Updated ${e(doc.date)}</div>
  <div class="meta official">Official version: ${e(config.officialUrl)}</div>
</header>
${body}
</body>
</html>`;
}

function footer(config, doc) {
  const e = escapeHtml;
  return `
    <div style="font-family: Helvetica, Arial, sans-serif; font-size: 7.5pt; color: #777;
                width: 100%; margin: 0 16mm; display: flex; justify-content: space-between;">
      <span>${e(config.product)} · ${e(doc.title)} · PCB ${e(config.pcbVersion)}</span>
      <span>${e(config.footer)}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`;
}

// Builds every document in the config. Returns the paths of the PDFs written.
// Throws if a page can't load one of its files (a broken image link, say),
// so a bad PDF is never written silently.
export async function buildPdfs(configPath, { log = console.log } = {}) {
  const config = loadConfig(configPath);
  const marked = new Marked({ gfm: true }).use(gfmHeadingId());
  const tmp = mkdtempSync(join(tmpdir(), "product-pdf-"));
  // GitHub's Ubuntu runners block Chrome's sandbox, so it's turned off there.
  const args = ["--allow-file-access-from-files", ...(process.env.CI ? ["--no-sandbox"] : [])];
  const browser = await puppeteer.launch({ args });
  const written = [];
  try {
    for (const doc of config.documents) {
      // The cover replaces the document's own H1.
      const markdown = readFileSync(doc.srcPath, "utf8").replace(/^# .*\n/, "");
      doc.date = lastChanged(doc.srcPath);
      const body = rewriteLinks(marked.parse(markdown), config);
      const htmlPath = join(tmp, doc.out.replace(/\.pdf$/, ".html"));
      writeFileSync(htmlPath, renderHtml(config, doc, body));

      const tab = await browser.newPage();
      const failures = [];
      tab.on("requestfailed", (req) => failures.push(`${req.url()} (${req.failure()?.errorText})`));
      await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle0" });
      await tab.evaluate(() => document.fonts.ready);
      const broken = await tab.evaluate(() =>
        [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src));
      failures.push(...broken.filter((src) => !failures.some((f) => f.startsWith(src))));
      if (failures.length) {
        await tab.close();
        throw new Error(`${doc.src} refers to files that couldn't be loaded:\n  - ${failures.join("\n  - ")}`);
      }
      const pdf = await tab.pdf({
        format: config.paper,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: footer(config, doc),
        margin: { top: "16mm", bottom: "18mm", left: "16mm", right: "16mm" },
      });
      await tab.close();
      mkdirSync(dirname(doc.outPath), { recursive: true });
      writeFileSync(doc.outPath, stabilize(pdf, doc.date));
      written.push(doc.outPath);
      log(`wrote ${relative(process.cwd(), doc.outPath)}`);
    }
  } finally {
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  return written;
}
