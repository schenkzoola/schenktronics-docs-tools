// Builds 4 × 6 in packaging labels (box label and insert) for thermal printers.
// See README.md for the config format.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import { ConfigError, qrSvg } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// The short-form warning for lead, from schenktronics-business/compliance/prop65.md.
export const PROP65_LEAD = "⚠ WARNING: Risk of cancer and reproductive harm from exposure to lead. See www.P65Warnings.ca.gov.";

const DEFAULTS = {
  brand: "Schenktronics",
  logo: "docs/images/logo-dark.png",
  panel: "docs/images/panel.svg",
  prop65: PROP65_LEAD,
  outDir: "labels",
  specs: [],
};

// Label size in inches. 4 × 6 in is the standard thermal shipping label.
const WIDTH = 4;
const HEIGHT = 6;

export function loadLabelConfig(configPath) {
  const file = resolve(configPath);
  if (!existsSync(file)) throw new ConfigError(`Label config not found: ${file}`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`Label config is not valid JSON: ${file}\n${err.message}`);
  }
  const config = { ...DEFAULTS, ...raw };
  const problems = [];
  for (const key of ["product", "pcbVersion", "productDir", "url"]) {
    if (typeof config[key] !== "string" || !config[key]) problems.push(`"${key}" is required`);
  }
  if (config.url && !/^https:\/\//.test(config.url)) problems.push(`"url" must start with https://`);
  if (!Array.isArray(config.variants) || config.variants.length === 0) {
    problems.push(`"variants" must list at least one version, such as a kit or an assembled module`);
  } else {
    config.variants.forEach((v, i) => {
      for (const key of ["id", "name"]) if (typeof v[key] !== "string" || !v[key]) problems.push(`variants[${i}].${key} is required`);
      if (v.id && !/^[a-z0-9-]+$/.test(v.id)) problems.push(`variants[${i}].id may only use a-z, 0-9 and hyphens`);
      if (!v.insert || !Array.isArray(v.insert.items)) problems.push(`variants[${i}].insert.items is required`);
    });
  }
  if (problems.length) throw new ConfigError(`Problems in ${file}:\n  - ${problems.join("\n  - ")}`);

  const base = realpathSync(dirname(file));
  config.outDir = resolve(base, config.outDir);
  config.productDir = resolve(base, config.productDir);
  if (!existsSync(config.productDir)) {
    throw new ConfigError(`Product repo not found at ${config.productDir}. Clone it next to this repo, or fix "productDir".`);
  }
  for (const key of ["logo", "panel"]) {
    config[`${key}Path`] = resolve(config.productDir, config[key]);
    if (!existsSync(config[`${key}Path`])) throw new ConfigError(`"${key}" file not found: ${config[`${key}Path`]}`);
  }
  return config;
}

// The URL as printed under a QR code: no "https://", so it's short enough to type.
export const displayUrl = (url) => url.replace(/^https:\/\//, "").replace(/\/$/, "");

// The printed URL may wrap only after a slash. Each part stays whole (browsers
// would otherwise break at a hyphen, which is confusing when typing the URL);
// if a part is too wide, the label fails its fit check instead.
const urlHtml = (url) => displayUrl(url).split("/").map((part) => `<span class="nobr">${e(part)}</span>`).join("/<wbr>");

const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function page(title, body) {
  const fonts = pathToFileURL(join(dirname(require.resolve("@fontsource/inter/package.json")), "files")).href;
  const css = readFileSync(join(HERE, "labels.css"), "utf8").replaceAll("FONT_DIR", fonts);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${e(title)}</title><style>${css}</style></head>
<body><main class="label">${body}</main></body>
</html>`;
}

export async function boxLabelHtml(config, variant) {
  const specs = config.specs.map((s) => `<li>${e(s)}</li>`).join("");
  return page(`${config.product} ${variant.name} box label`, `
  <header>
    <img class="logo" src="${pathToFileURL(config.logoPath).href}" alt="${e(config.brand)}">
    <h1>${e(config.product)}</h1>
    <div class="variant">${e(variant.name)}</div>
  </header>
  <section class="box-middle">
    <img class="panel" src="${pathToFileURL(config.panelPath).href}" alt="Panel">
    <div class="box-side">
      <ul class="specs">${specs}</ul>
      <div class="qr">${await qrSvg(config.url)}</div>
      <div class="url">${urlHtml(config.url)}</div>
      <div class="pcb">PCB ${e(config.pcbVersion)}</div>
    </div>
  </section>
  <footer class="prop65">${e(config.prop65)}</footer>`);
}

export async function insertHtml(config, variant) {
  const { insert } = variant;
  const items = insert.items.map((item) => `<li>${e(item)}</li>`).join("");
  const listClass = insert.checklist === false ? "notes" : "checklist";
  return page(`${config.product} ${variant.name} insert`, `
  <header class="insert-header">
    <img class="logo" src="${pathToFileURL(config.logoPath).href}" alt="${e(config.brand)}">
    <div class="thanks">Thank you!</div>
    <div class="thanks-sub">${e(insert.thanks ?? `Enjoy your ${config.product}.`)}</div>
  </header>
  <section class="insert-qr">
    <div class="qr">${await qrSvg(config.url)}</div>
    <div class="qr-caption">${e(insert.qrCaption ?? "Manual, assembly guide and build video")}</div>
    <div class="url big">${urlHtml(config.url)}</div>
  </section>
  <section class="insert-list">
    <h2>${e(insert.title ?? "")}</h2>
    <ul class="${listClass}">${items}</ul>
    ${insert.note ? `<p class="note">${e(insert.note)}</p>` : ""}
  </section>
  <footer class="insert-footer">${e(displayUrl(config.brandUrl ?? "https://schenktronics.com"))}</footer>`);
}

// Builds a box label and an insert for every variant. Returns the paths written.
// Throws if a label's content doesn't fit on one 4 × 6 in page.
export async function buildLabels(configPath, { log = console.log } = {}) {
  const config = loadLabelConfig(configPath);
  const browser = await puppeteer.launch({ args: ["--allow-file-access-from-files", ...(process.env.CI ? ["--no-sandbox"] : [])] });
  // Pages are written to files and opened from there, because a page set from
  // memory isn't allowed to load the local logo, drawing and fonts.
  const tmp = mkdtempSync(join(tmpdir(), "product-labels-"));
  const written = [];
  try {
    for (const variant of config.variants) {
      for (const [kind, render] of [["box", boxLabelHtml], ["insert", insertHtml]]) {
        const tab = await browser.newPage();
        await tab.setViewport({ width: WIDTH * 96, height: HEIGHT * 96 });
        const failures = [];
        tab.on("requestfailed", (req) => failures.push(req.url()));
        const htmlPath = join(tmp, `${kind}-${variant.id}.html`);
        writeFileSync(htmlPath, await render(config, variant));
        await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle0" });
        await tab.evaluate(() => document.fonts.ready);
        const overflow = await tab.evaluate(() => {
          const label = document.querySelector(".label");
          return label.scrollHeight > label.clientHeight + 1 || label.scrollWidth > label.clientWidth + 1;
        });
        const name = `${kind}-${variant.id}.pdf`;
        if (failures.length) throw new Error(`${name}: couldn't load ${failures.join(", ")}`);
        if (overflow) throw new Error(`${name}: the content doesn't fit on a ${WIDTH} × ${HEIGHT} in label. Shorten the text in the config.`);
        const pdf = await tab.pdf({ width: `${WIDTH}in`, height: `${HEIGHT}in`, printBackground: true, pageRanges: "1" });
        await tab.close();
        mkdirSync(config.outDir, { recursive: true });
        const out = join(config.outDir, name);
        writeFileSync(out, pdf);
        written.push(out);
        log(`wrote ${relative(process.cwd(), out)}`);
      }
    }
  } finally {
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  return written;
}
