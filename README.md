# Schenktronics docs tools

Shared tooling for Schenktronics product repos:

- **Docs PDFs**: a GitHub Action that builds a product's documentation PDFs from its Markdown docs and commits them.
- **Packaging labels**: a command that makes print-ready 4 × 6 in thermal labels (box label and insert) for each version of a product. See [Packaging labels](#packaging-labels).

It lives in its own repo so product repos stay limited to the device itself: KiCad files, gerbers, docs and images. Fixes and improvements here reach every product at once.

## Using it in a product repo

A product repo needs two files.

**1. `docs/pdf/config.json`**

```json
{
  "product": "Passive Multiple",
  "pcbVersion": "v1.0",
  "repo": "schenkzoola/Multiples",
  "branch": "master",
  "documents": [
    { "src": "manual.md", "out": "passive-multiple-manual.pdf", "title": "User Manual" },
    { "src": "assembly-guide.md", "out": "passive-multiple-assembly-guide.pdf", "title": "Assembly Guide" }
  ]
}
```

**2. `.github/workflows/pdf.yml`**: copy [`examples/pdf.yml`](examples/pdf.yml). Its main step is:

```yaml
- uses: schenkzoola/schenktronics-docs-tools/pdf@v1
```

Whenever the docs change, the Action rebuilds the PDFs into `docs/pdf/` and commits any that changed. After updating this repo, run each product's "Build PDFs" workflow by hand from its Actions tab to pick up the change.

### Config settings

| Setting | Required | Default | Meaning |
|---------|----------|---------|---------|
| `product` | Yes | | Product name, shown on the cover and in the footer |
| `pcbVersion` | Yes | | PCB revision the docs describe, for example `v1.0` |
| `repo` | Yes | | GitHub repo as `owner/name`. Used for links and the "Official version" line. |
| `branch` | Yes | | Branch that links to repo files point at |
| `documents` | Yes | | List of `{ src, out, title }`. `src` is relative to the docs folder, and `out` is the PDF file name. |
| `docsDir` | | `..` | Docs folder, relative to the config file |
| `outDir` | | `.` | Where to write the PDFs, relative to the config file |
| `logo` | | `images/logo-dark.png` | Cover logo, relative to the docs folder. If the file is missing, the cover shows `brand` as text. |
| `brand` | | `Schenktronics` | Brand name, used for the logo's alt text or as the text fallback |
| `officialUrl` | | `github.com/<repo>` | Shown on the cover as "Official version: …", so readers can check a copy against the real thing |
| `qrUrl` | | none | If set, a QR code to this URL goes in the cover's top-right corner, captioned "Latest version". Must start with `https://`. Use the same short URL as the packaging, and set it only once that URL works. |
| `footer` | | `schenktronics.com · CC BY-NC-SA 4.0` | Middle of the page footer |
| `paper` | | `Letter` | Any paper size Chrome supports, for example `A4` |

### What the PDFs contain

- A cover block with the logo, product name, document title, PCB version, the "Updated" date, the "Official version" line and, if `qrUrl` is set, a QR code. It replaces the document's own `#` heading.
- A footer on every page with the product, document and PCB version, the `footer` text, and page numbers.
- The Inter font, bundled so the output looks the same everywhere.
- Links to other files in the repo, rewritten to GitHub URLs. Every web link has its URL printed after it, because paper copies can't be clicked.
- An "Updated" date taken from the Markdown file's last commit. The PDFs' internal timestamps and numbering are made stable, so unchanged docs rebuild to identical files and the Action only commits real changes.

If a document refers to an image or file that doesn't exist, the build fails and names the missing file, rather than producing a PDF with a gap in it.

## Previewing locally

You need Node.js 22.12 or newer. The first `npm install` downloads a copy of Chrome.

```sh
cd ~/Products/schenktronics-docs-tools/pdf
npm install
node build.mjs ~/Products/Multiples/docs/pdf/config.json
```

Don't commit locally built PDFs. A different Chrome version produces slightly different files, so let the product's Action build the committed copies. To throw away a local build, run `git checkout -- 'docs/pdf/*.pdf'` in the product repo.

## Packaging labels

`pdf/labels.mjs` makes a **box label** and an **insert** for each version of a product (for example "DIY Kit" and "Assembled"), as 4 × 6 in PDFs for a thermal printer. Each label's settings live in a `labels.json` file, which is kept with the product's private packaging files, not in the public product repo.

```sh
node ~/Products/schenktronics-docs-tools/pdf/labels.mjs path/to/labels.json
```

- **Box label:** logo, product name, version badge, panel drawing, specs, QR code with its URL, PCB version, and the short Prop 65 warning for lead.
- **Insert:** thank-you line, a large QR code with its URL, and a checklist (kits) or quick-start notes (assembled modules).

### Label settings

| Setting | Required | Default | Meaning |
|---------|----------|---------|---------|
| `product` | Yes | | Product name |
| `pcbVersion` | Yes | | PCB revision, for example `v1.0` |
| `productDir` | Yes | | The product's repo, relative to `labels.json`. Clone repos side by side, for example in `~/Products`. |
| `url` | Yes | | What the QR code opens. Must start with `https://`. Printed under the code without the `https://`. |
| `variants` | Yes | | List of `{ id, name, insert }`. `id` names the files (`box-<id>.pdf`, `insert-<id>.pdf`). `insert` has `items` (required), plus optional `title`, `thanks`, `qrCaption`, `note`, and `checklist: false` for bullets instead of tick boxes. |
| `specs` | | none | Short lines listed beside the panel drawing |
| `logo` | | `docs/images/logo-dark.png` | Relative to `productDir` |
| `panel` | | `docs/images/panel.svg` | Relative to `productDir`. A version without small captions prints better on thermal labels. |
| `prop65` | | the short-form lead warning | Warning text on the box label |
| `outDir` | | `labels` | Where to write the PDFs, relative to `labels.json` |

### Designing for a thermal printer

Thermal printers print pure black only. The labels use black text and lines, and they convert images to black and white, so greys and colours don't turn into speckled patterns. Small grey captions disappear, so use a plain drawing. The QR code uses medium error correction, so a scuffed or slightly faded label still scans.

If a label's content doesn't fit on one 4 × 6 in page, the build fails with a message instead of cutting it off. The printed URL wraps only after a slash, never mid-word.

Print the PDFs at 100% ("actual size"), not "fit to page".

## Testing

```sh
cd pdf
npm test
```

- **`test/unit.test.mjs`**: config checking, link rewriting, and the timestamp and numbering fixes. These don't need a browser.
- **`test/labels.test.mjs`**: builds labels for the sample product, and checks the page size, content, URL wrapping, the fit check and the settings checks.
- **`test/build.test.mjs`**: builds the sample product in [`pdf/test/fixtures/sample-product`](pdf/test/fixtures/sample-product) and checks the cover, footer, links, fonts, images, dates and paper size. It also checks that rebuilding gives identical files, and that a missing image stops the build.

On GitHub, the [Test workflow](.github/workflows/test.yml) runs these tests on every push. It then builds **every real product's docs** with the changed code and reports whether their output would change. When you start using the Action in a new product repo, add that repo to the `product` list in the workflow.

If a change is meant to alter the output (a new cover layout, say), the product builds will report a difference. That's expected. If it isn't meant to, the report tells you which products it would affect before you release.

## Releasing

Product repos use the `v1` tag, which always points at the latest compatible release. To release:

```sh
git tag v1.1.0
git tag -f v1
git push origin v1.1.0
git push -f origin v1
```

For a change that would break existing product configs, release it as `v2` instead, and update each product's workflow when you're ready.

## License

This tooling is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You may use, change and share it for noncommercial purposes. Commercial use needs permission from Nathan Schenk.

The Schenktronics name and logo, including the logo in the test fixture, are trademarks of Nathan Schenk and are not covered by this license.
