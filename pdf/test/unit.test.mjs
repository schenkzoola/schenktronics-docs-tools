// Fast tests for the pieces of lib.mjs that don't need a browser.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ConfigError, lastChanged, loadConfig, normalizeNodeIds, pinTimestamps, qrSvg, renderHtml, rewriteLinks } from "../lib.mjs";
import { COMMIT_DATE, editJson, makeProduct } from "./helpers.mjs";

describe("loadConfig", () => {
  test("applies defaults and resolves paths from the config file's folder", () => {
    const { config } = makeProduct();
    const dir = realpathSync(join(config, "../../.."));
    const c = loadConfig(config);
    assert.equal(c.docsDir, join(dir, "docs"));
    assert.equal(c.outDir, join(dir, "docs/pdf"));
    assert.equal(c.documents[0].srcPath, join(dir, "docs/manual.md"));
    assert.equal(c.documents[0].outPath, join(dir, "docs/pdf/sample-manual.pdf"));
    assert.equal(c.paper, "Letter");
    assert.equal(c.brand, "Schenktronics");
    assert.equal(c.officialUrl, "github.com/example/sample-product");
    assert.equal(c.blobBase, "https://github.com/example/sample-product/blob/main");
  });

  test("lets the config override the official URL", () => {
    const { config } = makeProduct("sample-product", (d) =>
      editJson(join(d, "docs/pdf/config.json"), (c) => { c.officialUrl = "schenktronics.com/sample"; }));
    assert.equal(loadConfig(config).officialUrl, "schenktronics.com/sample");
  });

  test("requires the cover QR URL to use https", () => {
    const { config } = makeProduct("sample-product", (d) =>
      editJson(join(d, "docs/pdf/config.json"), (c) => { c.qrUrl = "http://example.com/x"; }));
    assert.throws(() => loadConfig(config), /"qrUrl" must start with https:\/\//);
  });

  test("reports a missing config file", () => {
    assert.throws(() => loadConfig("/nonexistent/config.json"), (e) => e instanceof ConfigError && /not found/.test(e.message));
  });

  test("reports invalid JSON", () => {
    const file = join(mkdtempSync(join(tmpdir(), "cfg-")), "config.json");
    writeFileSync(file, "{ not json");
    assert.throws(() => loadConfig(file), /not valid JSON/);
  });

  test("lists every missing or malformed field at once", () => {
    const file = join(mkdtempSync(join(tmpdir(), "cfg-")), "config.json");
    writeFileSync(file, JSON.stringify({ repo: "no-slash", documents: [{ src: "a.md", out: "a.txt" }] }));
    assert.throws(() => loadConfig(file), (e) => {
      for (const want of ['"product" is required', '"pcbVersion" is required', '"branch" is required',
        '"repo" must look like', "documents[0].title is required", "documents[0].out must end in .pdf"]) {
        assert.match(e.message, new RegExp(want.replace(/[.[\]"]/g, "\\$&")));
      }
      return true;
    });
  });

  test("reports a document that doesn't exist", () => {
    const { config } = makeProduct("sample-product", (d) =>
      editJson(join(d, "docs/pdf/config.json"), (c) => { c.documents[0].src = "missing.md"; }));
    assert.throws(() => loadConfig(config), /Document not found: .*missing\.md/);
  });
});

describe("cover QR code", () => {
  test("appears on the cover only when qrUrl is set", async () => {
    const { config } = makeProduct();
    const c = loadConfig(config);
    const doc = { ...c.documents[0], date: "2024-01-02" };
    // Look for the element, not the class name: the embedded stylesheet mentions it too.
    assert.ok(!renderHtml(c, doc, "<p>Body</p>").includes('<div class="cover-qr">'));
    const withQr = renderHtml(c, doc, "<p>Body</p>", await qrSvg("https://example.com/sample"));
    assert.match(withQr, /<div class="cover-qr"><svg/);
    assert.ok(withQr.includes("Latest version"));
  });
});

describe("rewriteLinks", () => {
  const where = { docsDir: "/repo/docs", rootDir: "/repo", blobBase: "https://github.com/o/r/blob/main" };

  test("points links to repo files at GitHub", () => {
    assert.equal(rewriteLinks('<a href="BOM.md">', where), '<a href="https://github.com/o/r/blob/main/docs/BOM.md">');
    assert.equal(rewriteLinks('<a href="../hw/board.sch">', where), '<a href="https://github.com/o/r/blob/main/hw/board.sch">');
  });

  test("leaves anchors, web links and mail links alone", () => {
    for (const html of ['<a href="#good-practice">', '<a href="https://example.com/x">', '<a href="mailto:a@b.c">']) {
      assert.equal(rewriteLinks(html, where), html);
    }
  });
});

describe("pinTimestamps", () => {
  const pdf = Buffer.from("x /CreationDate (D:20260924123456+00'00') y /ModDate (D:20260924123456+00'00') z", "latin1");

  test("sets both timestamps to the given date without changing the length", () => {
    const out = pinTimestamps(pdf, "2024-01-02").toString("latin1");
    assert.equal(out, "x /CreationDate (D:20240102000000+00'00') y /ModDate (D:20240102000000+00'00') z");
    assert.equal(out.length, pdf.length);
  });

  test("rejects a malformed date", () => {
    assert.throws(() => pinTimestamps(pdf, "Jan 2 2024"), /YYYY-MM-DD/);
  });
});

describe("normalizeNodeIds", () => {
  // Two builds of the same page, as Chrome produced them: the raw IDs differ,
  // and so does their order.
  const build = (first, second, index) => Buffer.from(
    `59 0 obj\n<</S /TH /ID ${first}>>\nendobj\n60 0 obj\n<</S /TH /ID ${second}>>\nendobj\n` +
    `61 0 obj\n<</S /TD /A [<</O /Table /Headers [${first}]>>]>>\nendobj\n` +
    `207 0 obj\n<</Limits [(node00000030) (node00000031)]\n/Names [${index}]>>\nendobj\n`, "latin1");
  const runA = build("(node00000030)", "(node00000031)", "(node00000030) 59 0 R (node00000031) 60 0 R");
  const runB = build("(node00000031)", "(node00000030)", "(node00000030) 60 0 R (node00000031) 59 0 R");

  test("gives identical output whatever numbers and order Chrome used", () => {
    assert.ok(normalizeNodeIds(runA).equals(normalizeNodeIds(runB)));
  });

  test("numbers IDs in file order and keeps the ID index sorted", () => {
    const out = normalizeNodeIds(runB).toString("latin1");
    assert.match(out, /59 0 obj\n<<\/S \/TH \/ID \(node00000001\)>>/);
    assert.match(out, /60 0 obj\n<<\/S \/TH \/ID \(node00000002\)>>/);
    assert.match(out, /\/Headers \[\(node00000001\)\]/, "references follow the renumbering");
    assert.match(out, /\/Limits \[\(node00000001\) \(node00000002\)\]\n\/Names \[\(node00000001\) 59 0 R \(node00000002\) 60 0 R\]/);
  });

  test("keeps the file the same length", () => {
    assert.equal(normalizeNodeIds(runB).length, runB.length);
  });
});

describe("lastChanged", () => {
  test("uses the file's last commit date", () => {
    const { dir } = makeProduct();
    assert.equal(lastChanged(join(dir, "docs/manual.md")), COMMIT_DATE);
  });

  test("falls back to today for a file git doesn't track", () => {
    const file = join(mkdtempSync(join(tmpdir(), "untracked-")), "a.md");
    writeFileSync(file, "# A\n");
    assert.equal(lastChanged(file), new Date().toISOString().slice(0, 10));
  });
});
