// End-to-end tests: build the sample product's PDFs in headless Chrome and check the results.
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { before, describe, test } from "node:test";
import { buildPdfs } from "../lib.mjs";
import { COMMIT_DATE, editJson, makeProduct, readPdf, silent } from "./helpers.mjs";

describe("building the sample product", () => {
  let product, written, manual, guide;

  before(async () => {
    product = makeProduct();
    written = await buildPdfs(product.config, silent);
    manual = await readPdf(join(product.dir, "docs/pdf/sample-manual.pdf"));
    guide = await readPdf(join(product.dir, "docs/pdf/sample-assembly-guide.pdf"));
  });

  test("writes one PDF per document in the config", () => {
    assert.deepEqual(written.map((p) => p.split("/").pop()), ["sample-manual.pdf", "sample-assembly-guide.pdf"]);
    assert.ok(manual.pages.length >= 1);
    assert.ok(guide.pages.length >= 1);
  });

  test("puts the cover block on page 1", () => {
    const cover = manual.pages[0];
    for (const want of ["Sample Module", "User Manual", "For PCB v9.9", `Updated ${COMMIT_DATE}`,
      "Official version: github.com/example/sample-product"]) {
      assert.ok(cover.includes(want), `cover is missing "${want}"`);
    }
    assert.ok(guide.pages[0].includes("Assembly Guide"));
  });

  test("replaces the document's own H1 with the cover", () => {
    assert.ok(!manual.text.includes("Sample Module — User Manual"));
  });

  test("puts the footer on every page", () => {
    manual.pages.forEach((page, i) => {
      assert.ok(page.includes("Sample Module · User Manual · PCB v9.9"), `page ${i + 1} footer`);
      assert.ok(page.includes("schenktronics.com · CC BY-NC-SA 4.0"), `page ${i + 1} footer`);
      assert.ok(page.includes(`Page ${i + 1} of ${manual.pages.length}`), `page ${i + 1} number`);
    });
  });

  test("turns links to repo files into GitHub links", () => {
    const base = "https://github.com/example/sample-product/blob/main";
    assert.ok(manual.links.includes(`${base}/docs/assembly-guide.md`));
    assert.ok(manual.links.includes(`${base}/hardware/board.kicad_pcb`));
    assert.ok(manual.links.includes("https://example.com/datasheet.pdf"));
    assert.ok(!manual.links.some((url) => url.startsWith("file:")), "no local file links");
  });

  test("prints the URL after each web link, for paper copies", () => {
    // Long URLs wrap, and pdf.js returns the pieces separately, so ignore whitespace.
    assert.ok(manual.text.replace(/\s+/g, "").includes("(https://example.com/datasheet.pdf)"));
  });

  test("renders tables, checklists and blockquotes", () => {
    assert.ok(manual.text.includes("Eurorack, 4HP"));
    assert.ok(guide.text.includes("1 × PCB"));
    assert.ok(guide.text.includes("A side note, rendered as a blockquote."));
  });

  test("embeds the Inter font and the images", () => {
    const bytes = readFileSync(join(product.dir, "docs/pdf/sample-manual.pdf")).toString("latin1");
    assert.match(bytes, /\/FontName\s*\/[A-Z]{6}\+Inter/, "Inter is embedded");
    const images = bytes.match(/\/Subtype\s*\/Image/g) ?? [];
    assert.ok(images.length >= 2, `expected the logo and the photo as images, found ${images.length}`);
  });

  test("pins the PDF timestamps to the commit date", () => {
    const bytes = readFileSync(join(product.dir, "docs/pdf/sample-manual.pdf")).toString("latin1");
    const stamp = `D:${COMMIT_DATE.replaceAll("-", "")}000000`;
    assert.match(bytes, new RegExp(`/CreationDate \\(${stamp}`));
    assert.match(bytes, new RegExp(`/ModDate \\(${stamp}`));
  });

  test("produces identical files when rebuilt", async () => {
    // Chrome varies some internal numbering between runs, so rebuild a few times.
    const first = written.map((p) => readFileSync(p));
    for (let run = 1; run <= 3; run++) {
      await buildPdfs(product.config, silent);
      written.forEach((p, i) => assert.ok(readFileSync(p).equals(first[i]), `${p} changed on rebuild ${run}`));
    }
  });
});

describe("problems in a product's docs", () => {
  test("fails with a clear message when an image is missing", async () => {
    const { config } = makeProduct("sample-product", (dir) => rmSync(join(dir, "docs/images/drawing.svg")));
    await assert.rejects(buildPdfs(config, silent), (e) => {
      assert.match(e.message, /manual\.md refers to files that couldn't be loaded/);
      assert.match(e.message, /drawing\.svg/);
      return true;
    });
  });

  test("uses the brand name as text when the logo file is missing", async () => {
    const { dir, config } = makeProduct("sample-product", (d) => rmSync(join(d, "docs/images/logo-dark.png")));
    await buildPdfs(config, silent);
    const { pages } = await readPdf(join(dir, "docs/pdf/sample-manual.pdf"));
    assert.match(pages[0], /schenktronics/i);
  });

  test("honours the paper size setting", async () => {
    const { dir, config } = makeProduct("sample-product", (d) =>
      editJson(join(d, "docs/pdf/config.json"), (c) => { c.paper = "A4"; }));
    await buildPdfs(config, silent);
    const bytes = readFileSync(join(dir, "docs/pdf/sample-manual.pdf")).toString("latin1");
    assert.match(bytes, /\/MediaBox \[0 0 595\.\d+ 841\.\d+\]/, "A4 is 595 × 842 points");
  });
});
