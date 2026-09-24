// Tests for the packaging label builder, using the sample product's logo and drawing.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, test } from "node:test";
import { buildLabels, displayUrl, loadLabelConfig, PROP65_LEAD } from "../labels-lib.mjs";
import { ConfigError } from "../lib.mjs";
import { editJson, FIXTURES, readPdf, silent } from "./helpers.mjs";

// Copies the label fixture and the sample product side by side, like ~/Products.
function makeLabels(edit = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "docs-tools-labels-"));
  cpSync(join(FIXTURES, "labels"), join(dir, "labels"), { recursive: true });
  cpSync(join(FIXTURES, "sample-product"), join(dir, "sample-product"), { recursive: true });
  const config = join(dir, "labels/labels.json");
  editJson(config, edit);
  return { dir, config };
}

describe("building labels", () => {
  let dir, written, pdfs;

  before(async () => {
    ({ dir } = makeLabels());
    written = await buildLabels(join(dir, "labels/labels.json"), silent);
    pdfs = {};
    for (const file of written) pdfs[file.split("/").pop()] = await readPdf(file);
  });

  test("writes a box label and an insert for each version", () => {
    assert.deepEqual(Object.keys(pdfs).sort(),
      ["box-assembled.pdf", "box-kit.pdf", "insert-assembled.pdf", "insert-kit.pdf"]);
  });

  test("makes each label a single 4 × 6 in page", () => {
    for (const file of written) {
      const bytes = readFileSync(file).toString("latin1");
      assert.match(bytes, /\/MediaBox \[0 0 288 432\]/, `${file} is 288 × 432 points`);
      assert.equal(pdfs[file.split("/").pop()].pages.length, 1, `${file} has one page`);
    }
  });

  test("puts the product, version, specs, URL and Prop 65 warning on the box label", () => {
    const text = pdfs["box-kit.pdf"].text;
    // The version badge is set in capitals.
    assert.match(text, /DIY KIT/i);
    for (const want of ["Sample Module", "4HP Eurorack", "PCB v9.9"]) {
      assert.ok(text.includes(want), `box label is missing "${want}"`);
    }
    assert.ok(text.replace(/\s+/g, "").includes("example.com/sample-module"), "box label has the URL");
    assert.ok(text.replace(/\s+/g, " ").includes(PROP65_LEAD.replace("⚠ ", "")), "box label has the lead warning");
    assert.match(pdfs["box-assembled.pdf"].text, /ASSEMBLED/i);
  });

  test("puts the checklist or quick-start notes on the insert", () => {
    assert.ok(pdfs["insert-kit.pdf"].text.includes("In this kit"));
    assert.ok(pdfs["insert-kit.pdf"].text.includes("1 × faceplate"));
    assert.ok(pdfs["insert-kit.pdf"].text.includes("Solder not included."));
    assert.ok(pdfs["insert-assembled.pdf"].text.includes("Fit it in any 4HP space."));
  });

  test("never breaks the printed URL in the middle of a word", () => {
    // The URL may wrap after its slash, but the host and the path each stay whole.
    // (pdf.js returns the host, the slash and the path as separate pieces.)
    for (const name of ["box-kit.pdf", "insert-kit.pdf"]) {
      const words = pdfs[name].text.split(/\s+/);
      assert.ok(words.includes("example.com"), `${name}: host intact`);
      assert.ok(words.includes("sample-module"), `${name}: path intact`);
    }
  });
});

describe("label problems", () => {
  test("fails when the content won't fit on the label", async () => {
    const { config } = makeLabels((c) => {
      c.variants[0].insert.items = Array.from({ length: 40 }, (_, i) => `Part number ${i + 1}`);
    });
    await assert.rejects(buildLabels(config, silent), /insert-kit\.pdf: the content doesn't fit/);
  });

  test("reports a missing product repo clearly", () => {
    const { config } = makeLabels((c) => { c.productDir = "../not-here"; });
    assert.throws(() => loadLabelConfig(config), (e) => e instanceof ConfigError && /Product repo not found/.test(e.message));
  });

  test("checks the required settings", () => {
    const { config } = makeLabels((c) => { c.url = "http://insecure.example.com"; c.variants[0].id = "Kit One"; delete c.pcbVersion; });
    assert.throws(() => loadLabelConfig(config), (e) => {
      assert.match(e.message, /"pcbVersion" is required/);
      assert.match(e.message, /"url" must start with https:\/\//);
      assert.match(e.message, /variants\[0\]\.id may only use/);
      return true;
    });
  });

  test("prints the URL without https://", () => {
    assert.equal(displayUrl("https://schenktronics.com/passive-multiple"), "schenktronics.com/passive-multiple");
    assert.equal(displayUrl("https://schenktronics.com/"), "schenktronics.com");
  });
});
