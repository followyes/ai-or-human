import {
  AvifConversionError,
  MAX_SOURCE_PIXELS,
  calculateInventoryPreviewGeometry,
  encodeImageDataToAvif,
  sha256Blob,
  validateSourceFile
} from "./avif-converter.js";

const MESSAGE_INSPECT = "inspect";
const MESSAGE_PREPARE = "prepare";

function validateDimensions(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new AvifConversionError(
      "SOURCE_DIMENSIONS_INVALID",
      "Obraz ma nieprawidłowe wymiary."
    );
  }

  if (width * height > MAX_SOURCE_PIXELS) {
    throw new AvifConversionError(
      "SOURCE_PIXELS_TOO_LARGE",
      "Obraz przekracza techniczny limit bezpieczeństwa 100 megapikseli."
    );
  }
}

function validateSourceInspection(sourceInspection, file) {
  if (
    !sourceInspection ||
    typeof sourceInspection.filename !== "string" ||
    typeof sourceInspection.mimeType !== "string" ||
    !Number.isFinite(sourceInspection.size) ||
    typeof sourceInspection.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(sourceInspection.sha256)
  ) {
    throw new AvifConversionError(
      "SOURCE_INSPECTION_INVALID",
      "Wynik wstępnej analizy pliku jest nieprawidłowy."
    );
  }

  const validated = validateSourceFile(file);
  if (
    validated.filename !== sourceInspection.filename ||
    validated.mimeType !== sourceInspection.mimeType ||
    validated.size !== sourceInspection.size
  ) {
    throw new AvifConversionError(
      "SOURCE_INSPECTION_MISMATCH",
      "Plik zmienił się pomiędzy analizą a przygotowaniem."
    );
  }
}

async function decodeSourceBlob(blob) {
  if (typeof createImageBitmap !== "function") {
    throw new AvifConversionError(
      "WORKER_IMAGE_BITMAP_UNAVAILABLE",
      "Przeglądarka nie obsługuje bezpiecznego dekodowania obrazu w tle."
    );
  }

  try {
    return await createImageBitmap(blob, {
      imageOrientation: "from-image",
      premultiplyAlpha: "default",
      colorSpaceConversion: "default"
    });
  } catch (error) {
    throw new AvifConversionError(
      "SOURCE_DECODE_FAILED",
      "Nie udało się odczytać obrazu.",
      { cause: error }
    );
  }
}

function createWorkerCanvas(width, height) {
  if (typeof OffscreenCanvas !== "function") {
    throw new AvifConversionError(
      "WORKER_CANVAS_UNAVAILABLE",
      "Przeglądarka nie obsługuje przetwarzania obrazu poza głównym wątkiem."
    );
  }

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", {
    alpha: true,
    colorSpace: "srgb",
    willReadFrequently: true
  });

  if (!context) {
    throw new AvifConversionError(
      "CANVAS_CONTEXT_UNAVAILABLE",
      "Nie udało się utworzyć kontekstu obrazu."
    );
  }

  return { canvas, context };
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  try {
    canvas.width = 1;
    canvas.height = 1;
  } catch {
    // Best-effort memory release only.
  }
}

async function verifyAvifBlob(blob, expectedWidth, expectedHeight) {
  if (!(blob instanceof Blob) || blob.type !== "image/avif" || blob.size <= 0) {
    throw new AvifConversionError(
      "AVIF_OUTPUT_INVALID",
      "Wynik konwersji nie jest prawidłowym plikiem AVIF."
    );
  }

  let decoded = null;
  try {
    decoded = await decodeSourceBlob(blob);
    if (decoded.width !== expectedWidth || decoded.height !== expectedHeight) {
      throw new AvifConversionError(
        "AVIF_DIMENSIONS_CHANGED",
        "Weryfikacja AVIF wykryła nieoczekiwaną zmianę wymiarów."
      );
    }
  } finally {
    decoded?.close?.();
  }
}

async function encodePreviewFromDecoded(decoded, width, height) {
  const geometry = calculateInventoryPreviewGeometry(width, height);
  const { canvas, context } = createWorkerCanvas(geometry.outputWidth, geometry.outputHeight);

  let imageData = null;
  try {
    context.drawImage(
      decoded,
      geometry.sourceX,
      geometry.sourceY,
      geometry.cropWidth,
      geometry.cropHeight,
      0,
      0,
      geometry.outputWidth,
      geometry.outputHeight
    );

    imageData = context.getImageData(0, 0, geometry.outputWidth, geometry.outputHeight);
    releaseCanvas(canvas);

    const blob = await encodeImageDataToAvif(imageData);
    imageData = null;
    await verifyAvifBlob(blob, geometry.outputWidth, geometry.outputHeight);

    return {
      blob,
      width: geometry.outputWidth,
      height: geometry.outputHeight
    };
  } finally {
    imageData = null;
    releaseCanvas(canvas);
  }
}

function captureProductionPixels(decoded, width, height) {
  const { canvas, context } = createWorkerCanvas(width, height);
  try {
    context.drawImage(decoded, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally {
    // Once ImageData owns the snapshot, the full-resolution canvas backing
    // store is no longer needed and can be released before AVIF encoding.
    releaseCanvas(canvas);
  }
}

async function encodeProductionPixels(imageData, width, height) {
  const blob = await encodeImageDataToAvif(imageData);
  await verifyAvifBlob(blob, width, height);
  const sha256 = await sha256Blob(blob);
  return { blob, sha256 };
}

async function inspectFile(file) {
  const source = validateSourceFile(file);
  const sha256 = await sha256Blob(file);

  return {
    filename: source.filename,
    mimeType: source.mimeType,
    size: source.size,
    sha256
  };
}

async function prepareFile(file, sourceInspection) {
  validateSourceInspection(sourceInspection, file);

  let decoded = null;
  try {
    decoded = await decodeSourceBlob(file);
    const width = Number(decoded.width);
    const height = Number(decoded.height);
    validateDimensions(width, height);

    // Derive the Admin preview from the original decode. This avoids the old
    // production-AVIF re-decode solely for thumbnail creation.
    const preview = await encodePreviewFromDecoded(decoded, width, height);

    if (sourceInspection.mimeType === "image/avif") {
      decoded.close?.();
      decoded = null;

      const previewBuffer = await preview.blob.arrayBuffer();
      return {
        result: {
          source: sourceInspection,
          output: {
            buffer: null,
            mimeType: "image/avif",
            size: file.size,
            sha256: sourceInspection.sha256,
            width,
            height,
            passthrough: true
          },
          preview: {
            buffer: previewBuffer,
            mimeType: "image/avif",
            size: preview.blob.size,
            width: preview.width,
            height: preview.height
          }
        },
        transfer: [previewBuffer]
      };
    }

    // Snapshot production pixels, then release the source bitmap BEFORE the
    // expensive full-resolution AVIF encode starts. At this point the Worker
    // owns only the RGBA snapshot plus the small preview/codec state.
    let productionPixels = captureProductionPixels(decoded, width, height);
    decoded.close?.();
    decoded = null;

    const production = await encodeProductionPixels(productionPixels, width, height);
    productionPixels = null;

    const [outputBuffer, previewBuffer] = await Promise.all([
      production.blob.arrayBuffer(),
      preview.blob.arrayBuffer()
    ]);

    return {
      result: {
        source: sourceInspection,
        output: {
          buffer: outputBuffer,
          mimeType: "image/avif",
          size: production.blob.size,
          sha256: production.sha256,
          width,
          height,
          passthrough: false
        },
        preview: {
          buffer: previewBuffer,
          mimeType: "image/avif",
          size: preview.blob.size,
          width: preview.width,
          height: preview.height
        }
      },
      transfer: [outputBuffer, previewBuffer]
    };
  } finally {
    decoded?.close?.();
  }
}

function serializeError(error) {
  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    code: typeof error?.code === "string" ? error.code : "UPLOAD_WORKER_FAILED",
    message: typeof error?.message === "string"
      ? error.message
      : "Nie udało się przygotować obrazu w tle."
  };
}

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  const requestId = message.requestId;

  if (typeof requestId !== "string" || !requestId) return;

  try {
    if (message.type === MESSAGE_INSPECT) {
      const source = await inspectFile(message.file);
      self.postMessage({ requestId, ok: true, value: source });
      return;
    }

    if (message.type === MESSAGE_PREPARE) {
      const prepared = await prepareFile(message.file, message.sourceInspection);
      self.postMessage(
        { requestId, ok: true, value: prepared.result },
        prepared.transfer
      );
      return;
    }

    throw new AvifConversionError(
      "UPLOAD_WORKER_MESSAGE_INVALID",
      "Nieprawidłowe żądanie procesu przygotowania obrazu."
    );
  } catch (error) {
    self.postMessage({ requestId, ok: false, error: serializeError(error) });
  }
});
