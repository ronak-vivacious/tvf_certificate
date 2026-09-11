/**
 * pdfGenerator.js
 *
 * Generates the XRF Testing Certificate PDF by overlaying only the dynamic
 * fields (Name, Weight, Product, Purity, Product image) onto an exact copy
 * of the original reference PDF template. The template itself is embedded
 * as a vector page (not rasterized), so the logo, header, rules, fonts of
 * the static text, borders and spacing are pixel-for-pixel identical to the
 * original — nothing about the template is redrawn or redesigned.
 *
 * Coordinates below were measured directly from the reference PDF
 * (Loket_set.pdf) using its text/rect/image geometry, and map exactly to
 * the "Name / Weight / Product / Purity" rows and the photo box.
 */

const CertificateTemplate = (() => {
  // Fixed geometry measured from the reference PDF (points, PDF coordinate
  // space with origin at bottom-left). The template page itself is
  // 5553 x 3412 pt and is always used as-is (already landscape).
  const LAYOUT = {
    templateUrl: "assets/template/certificate-template.pdf",
    fontUrl: "assets/fonts/PTSerif-Bold.ttf",
    // left edge where a field's *value* text starts (after the label + colon)
    valueX: 1041,
    // right edge beyond which value text must not extend (kept clear of the
    // photo box, which starts at x = 3974)
    valueMaxX: 3900,
    // left edge used when clearing the old placeholder value (slightly
    // before valueX so no sliver of old ink is left behind)
    clearMinX: 1000,
    fields: {
      name: { top: 1165, bottom: 1285 },
      weight: { top: 1574, bottom: 1694 },
      product: { top: 1983, bottom: 2103 },
      purity: { top: 2392, bottom: 2512 },
    },
    // Inner white photo box (matches the black border box exactly)
    imageBox: { x: 4004, yBottom: 698.903931, width: 1200, height: 1582.191895 },
    clearPadding: 20, // extra vertical padding when clearing old text rows
    maxFontSize: 130,
    minFontSize: 40,
    fontStep: 2,
  };

  let cachedTemplateBytes = null;
  let cachedFontBytes = null;

  async function fetchArrayBuffer(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to load required asset: ${url}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  // Always returns a *fresh copy* of the cached bytes so that repeated
  // generations never share mutable state and no data can bleed between runs.
  async function getTemplateBytes() {
    if (!cachedTemplateBytes) {
      cachedTemplateBytes = await fetchArrayBuffer(LAYOUT.templateUrl);
    }
    return cachedTemplateBytes.slice();
  }

  async function getFontBytes() {
    if (!cachedFontBytes) {
      cachedFontBytes = await fetchArrayBuffer(LAYOUT.fontUrl);
    }
    return cachedFontBytes.slice();
  }

  function fitFontSize(font, text, maxWidth) {
    let size = LAYOUT.maxFontSize;
    while (size > LAYOUT.minFontSize && font.widthOfTextAtSize(text, size) > maxWidth) {
      size -= LAYOUT.fontStep;
    }
    return size;
  }

  function drawField(page, font, key, value) {
    const { top, bottom } = LAYOUT.fields[key];
    const clearTop = top - LAYOUT.clearPadding;
    const clearBottom = bottom + LAYOUT.clearPadding;
    const rectHeight = clearBottom - clearTop;
    const pageHeight = page.getHeight();
    const rectY = pageHeight - clearBottom;

    // 1. Clear the old placeholder value with a plain white rectangle.
    page.drawRectangle({
      x: LAYOUT.clearMinX,
      y: rectY,
      width: LAYOUT.valueMaxX - LAYOUT.clearMinX,
      height: rectHeight,
      color: PDFLib.rgb(1, 1, 1),
    });

    // 2. Draw the new value, auto-shrinking so it never overflows the row.
    const maxWidth = LAYOUT.valueMaxX - LAYOUT.valueX - 20;
    const fontSize = fitFontSize(font, value, maxWidth);
    const baselineY = rectY + (rectHeight - fontSize) / 2 + fontSize * 0.18;

    page.drawText(value, {
      x: LAYOUT.valueX,
      y: baselineY,
      size: fontSize,
      font,
      color: PDFLib.rgb(0.11, 0.11, 0.11),
    });
  }

  async function embedUserImage(pdfDoc, imageBytes, mimeType) {
    if (mimeType === "image/png") {
      return pdfDoc.embedPng(imageBytes);
    }
    // JPEG (and WebP is pre-converted to PNG by the caller before this point)
    return pdfDoc.embedJpg(imageBytes);
  }

  function drawImage(page, embeddedImage) {
    const box = LAYOUT.imageBox;

    // Clear the old photo with white, exactly matching the original box.
    page.drawRectangle({
      x: box.x,
      y: box.yBottom,
      width: box.width,
      height: box.height,
      color: PDFLib.rgb(1, 1, 1),
    });

    // Fit the uploaded image inside the box, preserving aspect ratio
    // ("contain"), centered both horizontally and vertically.
    const iw = embeddedImage.width;
    const ih = embeddedImage.height;
    const scale = Math.min(box.width / iw, box.height / ih);
    const drawW = iw * scale;
    const drawH = ih * scale;
    const drawX = box.x + (box.width - drawW) / 2;
    const drawY = box.yBottom + (box.height - drawH) / 2;

    page.drawImage(embeddedImage, { x: drawX, y: drawY, width: drawW, height: drawH });
  }

  /**
   * @param {Object} data
   * @param {string} data.name
   * @param {string} data.weight
   * @param {string} data.product
   * @param {string} data.purity
   * @param {Uint8Array} data.imageBytes
   * @param {string} data.imageMimeType  "image/png" | "image/jpeg"
   * @returns {Promise<Uint8Array>} the generated PDF bytes
   */
  async function generate(data) {
    const [templateBytes, fontBytes] = await Promise.all([
      getTemplateBytes(),
      getFontBytes(),
    ]);

    const pdfDoc = await PDFLib.PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const font = await pdfDoc.embedFont(fontBytes);
    const [embeddedPage] = await pdfDoc.embedPdf(templateBytes);
    const pageWidth = embeddedPage.width;
    const pageHeight = embeddedPage.height;

    // Landscape is guaranteed here because the template itself is landscape
    // (width > height) and we copy its exact dimensions without rotation.
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawPage(embeddedPage, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PDFLib.rgb(0xe4/255, 0xe9/255, 0xe2/255), opacity: 0.25 });

    drawField(page, font, "name", data.name);
    drawField(page, font, "weight", data.weight);
    drawField(page, font, "product", data.product);
    drawField(page, font, "purity", data.purity);

    const embeddedImage = await embedUserImage(pdfDoc, data.imageBytes, data.imageMimeType);
    drawImage(page, embeddedImage);

    pdfDoc.setTitle("XRF Testing Certificate");
    pdfDoc.setProducer("");
    pdfDoc.setCreator("");
    pdfDoc.setAuthor("");
    pdfDoc.setSubject("");
    pdfDoc.setKeywords([]);

    return pdfDoc.save();
  }

  return { generate };
})();
