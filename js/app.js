/**
 * app.js
 * Wires up the form UI to the PDF generator. Runs entirely client-side:
 * nothing the user types or uploads is ever sent anywhere.
 */
(() => {
  "use strict";

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
  const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
  const TEXT_FIELD_MAX_LEN = { name: 60, weight: 30, product: 40, purity: 30 };
  // Only allow reasonably plain text: letters (incl. common accented/Indic
  // ranges), numbers, spaces and a small set of punctuation. Anything else
  // is stripped rather than rejected, so a stray character doesn't block
  // the whole form.
  const SAFE_TEXT_PATTERN = /[^\p{L}\p{N}\s.,%/()'-]/gu;

  const form = document.getElementById("cert-form");
  const inputs = {
    name: document.getElementById("name"),
    weight: document.getElementById("weight"),
    product: document.getElementById("product"),
    purity: document.getElementById("purity"),
    image: document.getElementById("image"),
  };
  const errors = {
    name: document.getElementById("err-name"),
    weight: document.getElementById("err-weight"),
    product: document.getElementById("err-product"),
    purity: document.getElementById("err-purity"),
    image: document.getElementById("err-image"),
  };
  const imagePreview = document.getElementById("image-preview");
  const btnGenerate = document.getElementById("btn-generate");
  const btnDownload = document.getElementById("btn-download");
  const btnReset = document.getElementById("btn-reset");
  const statusMsg = document.getElementById("status-msg");
  const pdfPreviewFrame = document.getElementById("pdf-preview");
  const previewPlaceholder = document.getElementById("preview-placeholder");

  // Tracks object URLs so we can revoke them and guarantee no leftover data
  // (image previews or generated PDFs) survives past a reset / new run.
  let currentImagePreviewUrl = null;
  let currentPdfObjectUrl = null;
  let validatedImage = null; // { bytes: Uint8Array, mimeType: string }

  function setStatus(message, state) {
    statusMsg.textContent = message || "";
    if (state) {
      statusMsg.setAttribute("data-state", state);
    } else {
      statusMsg.removeAttribute("data-state");
    }
  }

  function clearFieldError(key) {
    if (errors[key]) errors[key].textContent = "";
  }

  function setFieldError(key, message) {
    if (errors[key]) errors[key].textContent = message;
  }

  function sanitizeText(raw, maxLen) {
    const stripped = raw.replace(SAFE_TEXT_PATTERN, "");
    const collapsed = stripped.replace(/\s+/g, " ").trim();
    return collapsed.slice(0, maxLen);
  }

  function readFieldValue(key) {
    const el = inputs[key];
    const clean = sanitizeText(el.value, TEXT_FIELD_MAX_LEN[key]);
    return clean;
  }

  // Verifies the file's real type via magic bytes rather than trusting the
  // browser-reported MIME type or file extension.
  function sniffImageType(bytes) {
    if (bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    if (bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return "image/webp";
    }
    return null;
  }

  function revokeImagePreviewUrl() {
    if (currentImagePreviewUrl) {
      URL.revokeObjectURL(currentImagePreviewUrl);
      currentImagePreviewUrl = null;
    }
  }

  function revokePdfUrl() {
    if (currentPdfObjectUrl) {
      URL.revokeObjectURL(currentPdfObjectUrl);
      currentPdfObjectUrl = null;
    }
  }

  // Converts any accepted image (including WebP, which pdf-lib cannot embed
  // directly) into a plain PNG via canvas, so the PDF generator always
  // receives a format it can embed. Also strips any metadata in the process
  // since canvas re-encoding only preserves pixel data.
  function toEmbeddablePng(bytes) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((outBlob) => {
            URL.revokeObjectURL(url);
            if (!outBlob) {
              reject(new Error("Could not process the image."));
              return;
            }
            outBlob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
          }, "image/png");
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read the image file."));
      };
      img.src = url;
    });
  }

  async function handleImageSelected() {
    clearFieldError("image");
    revokeImagePreviewUrl();
    imagePreview.hidden = true;
    validatedImage = null;

    const file = inputs.image.files && inputs.image.files[0];
    if (!file) return;

    if (file.size > MAX_IMAGE_BYTES) {
      setFieldError("image", "Image is too large (max 5 MB).");
      inputs.image.value = "";
      return;
    }

    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setFieldError("image", "Could not read the selected file.");
      inputs.image.value = "";
      return;
    }

    const sniffed = sniffImageType(bytes);
    if (!sniffed || !ALLOWED_MIME.includes(sniffed)) {
      setFieldError("image", "Only JPG, PNG or WebP images are allowed.");
      inputs.image.value = "";
      return;
    }

    try {
      let finalBytes = bytes;
      let finalMime = sniffed;
      if (sniffed === "image/webp") {
        finalBytes = await toEmbeddablePng(bytes);
        finalMime = "image/png";
      }
      validatedImage = { bytes: finalBytes, mimeType: finalMime };

      const previewBlob = new Blob([finalBytes], { type: finalMime });
      currentImagePreviewUrl = URL.createObjectURL(previewBlob);
      imagePreview.src = currentImagePreviewUrl;
      imagePreview.hidden = false;
    } catch (e) {
      setFieldError("image", "Could not process the image.");
      inputs.image.value = "";
    }
  }

  function validateForm() {
    let valid = true;
    ["name", "weight", "product", "purity"].forEach((key) => {
      const value = readFieldValue(key);
      clearFieldError(key);
      if (!value) {
        setFieldError(key, "This field is required.");
        valid = false;
      }
    });
    if (!validatedImage) {
      setFieldError("image", "Please upload a product image.");
      valid = false;
    }
    return valid;
  }

  function resetPreview() {
    revokePdfUrl();
    pdfPreviewFrame.src = "";
    pdfPreviewFrame.hidden = true;
    previewPlaceholder.hidden = false;
    btnDownload.disabled = true;
  }

  async function handleGenerate(event) {
    event.preventDefault();
    setStatus("");

    if (!validateForm()) {
      setStatus("Please fix the highlighted fields.", "error");
      return;
    }

    btnGenerate.disabled = true;
    setStatus("Generating certificate…");

    try {
      const data = {
        name: readFieldValue("name"),
        weight: readFieldValue("weight"),
        product: readFieldValue("product"),
        purity: readFieldValue("purity"),
        // Pass a fresh copy of the bytes so the generator never receives a
        // reference that could be mutated or reused elsewhere.
        imageBytes: validatedImage.bytes.slice(),
        imageMimeType: validatedImage.mimeType,
      };

      const pdfBytes = await CertificateTemplate.generate(data);

      // Replace any previous preview/download state completely — nothing
      // from a prior generation is kept around.
      revokePdfUrl();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      currentPdfObjectUrl = URL.createObjectURL(blob);

      pdfPreviewFrame.src = currentPdfObjectUrl;
      pdfPreviewFrame.hidden = false;
      previewPlaceholder.hidden = true;
      btnDownload.disabled = false;

      setStatus("Certificate generated successfully.", "success");
    } catch (err) {
      console.error(err);
      resetPreview();
      setStatus("Something went wrong while generating the PDF. Please try again.", "error");
    } finally {
      btnGenerate.disabled = false;
    }
  }

  function handleDownload() {
    if (!currentPdfObjectUrl) return;
    const nameValue = readFieldValue("name") || "certificate";
    const safeName = nameValue.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "_") || "certificate";
    const a = document.createElement("a");
    a.href = currentPdfObjectUrl;
    a.download = `XRF-Certificate-${safeName}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function handleReset() {
    Object.keys(errors).forEach(clearFieldError);
    setStatus("");
    revokeImagePreviewUrl();
    imagePreview.hidden = true;
    imagePreview.src = "";
    validatedImage = null;
    resetPreview();
    // form.reset() runs via the native reset button; give it a tick then
    // make sure our own state (file input, validated image) is fully clear.
    setTimeout(() => {
      inputs.image.value = "";
    }, 0);
  }

  inputs.image.addEventListener("change", handleImageSelected);
  form.addEventListener("submit", handleGenerate);
  form.addEventListener("reset", handleReset);
  btnDownload.addEventListener("click", handleDownload);

  window.addEventListener("beforeunload", () => {
    revokeImagePreviewUrl();
    revokePdfUrl();
  });
})();
