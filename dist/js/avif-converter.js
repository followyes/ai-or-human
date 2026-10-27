export const AVIF_ENCODER_MODULE_URL = "https://esm.sh/@jsquash/avif@2.1.1";

export const SUPPORTED_SOURCE_TYPES = Object.freeze(new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif"
]));

export const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
export const MAX_SOURCE_PIXELS = 100_000_000;
export const INVENTORY_PREVIEW_MAX_WIDTH = 640;
export const INVENTORY_PREVIEW_MAX_HEIGHT = 480;

let encoderPromise = null;

export class AvifConversionError extends Error {
  constructor(code, message, { cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AvifConversionError";
    this.code = code;
  }
}

function inferMimeType(file) {
  const explicit = typeof file?.type === "string" ? file.type.toLowerCase() : "";
  if (SUPPORTED_SOURCE_TYPES.has(explicit)) return explicit;

  const name = typeof file?.name === "string" ? file.name.toLowerCase() : "";
  if (/\.(jpe?g|jfif)$/.test(name)) return "image/jpeg";
  if (/\.png$/.test(name)) return "image/png";
  if (/\.webp$/.test(name)) return "image/webp";
  if (/\.avif$/.test(name)) return "image/avif";
  return "";
}

export function validateSourceFile(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new AvifConversionError("SOURCE_INVALID", "Nieprawidłowy plik wejściowy.");
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new AvifConversionError("SOURCE_EMPTY", "Plik jest pusty.");
  }

  if (file.size > MAX_SOURCE_BYTES) {
    throw new AvifConversionError(
      "SOURCE_TOO_LARGE",
      "Plik źródłowy przekracza techniczny limit bezpieczeństwa 128 MB."
    );
  }

  const mimeType = inferMimeType(file);
  if (!mimeType) {
    throw new AvifConversionError(
      "SOURCE_TYPE_UNSUPPORTED",
      "Obsługiwane formaty źródłowe: JPG/JPEG, PNG, WebP i AVIF."
    );
  }

  const filename = typeof file.name === "string" ? file.name.trim() : "";
  if (!filename || filename.length > 512) {
    throw new AvifConversionError(
      "SOURCE_NAME_INVALID",
      "Nazwa pliku musi mieć od 1 do 512 znaków."
    );
  }

  return Object.freeze({ filename, mimeType, size: file.size });
}

export async function sha256Blob(blob) {
  if (!globalThis.crypto?.subtle) {
    throw new AvifConversionError(
      "CRYPTO_UNAVAILABLE",
      "Przeglądarka nie udostępnia Web Crypto SHA-256."
    );
  }

  const bytes = await blob.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadAvifEncoder() {
  if (!encoderPromise) {
    encoderPromise = import(AVIF_ENCODER_MODULE_URL)
      .then((module) => {
        if (typeof module?.encode !== "function") {
          throw new AvifConversionError(
            "AVIF_ENCODER_INVALID",
            "Załadowany moduł AVIF nie udostępnia funkcji encode()."
          );
        }
        return module.encode;
      })
      .catch((error) => {
        encoderPromise = null;
        if (error instanceof AvifConversionError) throw error;
        throw new AvifConversionError(
          "AVIF_ENCODER_LOAD_FAILED",
          "Nie udało się załadować kodera AVIF.",
          { cause: error }
        );
      });
  }

  return encoderPromise;
}

export function calculateInventoryPreviewGeometry(
  sourceWidth,
  sourceHeight,
  {
    maxWidth = INVENTORY_PREVIEW_MAX_WIDTH,
    maxHeight = INVENTORY_PREVIEW_MAX_HEIGHT
  } = {}
) {
  const width = Number(sourceWidth);
  const height = Number(sourceHeight);
  validateDimensions(width, height);

  if (
    !Number.isFinite(maxWidth) ||
    !Number.isFinite(maxHeight) ||
    maxWidth <= 0 ||
    maxHeight <= 0
  ) {
    throw new AvifConversionError(
      "PREVIEW_TARGET_INVALID",
      "Nieprawidłowy rozmiar technicznego podglądu."
    );
  }

  const targetRatio = maxWidth / maxHeight;
  const sourceRatio = width / height;

  let sourceX = 0;
  let sourceY = 0;
  let cropWidth = width;
  let cropHeight = height;

  if (sourceRatio > targetRatio) {
    cropWidth = height * targetRatio;
    sourceX = (width - cropWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    cropHeight = width / targetRatio;
    sourceY = (height - cropHeight) / 2;
  }

  const scale = Math.min(1, maxWidth / cropWidth, maxHeight / cropHeight);
  const outputWidth = Math.max(1, Math.min(Math.floor(maxWidth), Math.round(cropWidth * scale)));
  const outputHeight = Math.max(1, Math.min(Math.floor(maxHeight), Math.round(cropHeight * scale)));

  return Object.freeze({
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    outputWidth,
    outputHeight
  });
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

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

async function decodeWithImageBitmap(file) {
  if (typeof createImageBitmap !== "function") return null;

  try {
    return await createImageBitmap(file, {
      imageOrientation: "from-image",
      premultiplyAlpha: "default",
      colorSpaceConversion: "default"
    });
  } catch {
    return null;
  }
}

async function decodeWithImageElement(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(
        new AvifConversionError("SOURCE_DECODE_FAILED", "Nie udało się odczytać obrazu.")
      );
    });

    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function decodeSource(file) {
  const bitmap = await decodeWithImageBitmap(file);
  if (bitmap) return bitmap;
  return decodeWithImageElement(file);
}

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

export async function encodeImageDataToAvif(
  imageData,
  { encoderLoader = loadAvifEncoder } = {}
) {
  const encode = await encoderLoader();

  let encoded;
  try {
    encoded = await encode(imageData);
  } catch (error) {
    throw new AvifConversionError(
      "AVIF_ENCODE_FAILED",
      "Konwersja do AVIF nie powiodła się.",
      { cause: error }
    );
  }

  const buffer = encoded instanceof ArrayBuffer
    ? encoded
    : (ArrayBuffer.isView(encoded)
        ? encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
        : null);

  if (!buffer || buffer.byteLength <= 0) {
    throw new AvifConversionError(
      "AVIF_ENCODE_EMPTY",
      "Koder AVIF zwrócił pusty wynik."
    );
  }

  return new Blob([buffer], { type: "image/avif" });
}

async function verifyAvifBlob(blob, expectedWidth, expectedHeight) {
  if (blob.type !== "image/avif" || blob.size <= 0) {
    throw new AvifConversionError(
      "AVIF_OUTPUT_INVALID",
      "Wynik konwersji nie jest prawidłowym plikiem AVIF."
    );
  }

  const decoded = await decodeWithImageBitmap(blob);
  if (!decoded) {
    throw new AvifConversionError(
      "AVIF_VERIFY_FAILED",
      "Przeglądarka nie potrafi ponownie odczytać wygenerowanego AVIF."
    );
  }

  try {
    if (decoded.width !== expectedWidth || decoded.height !== expectedHeight) {
      throw new AvifConversionError(
        "AVIF_DIMENSIONS_CHANGED",
        "Weryfikacja AVIF wykryła nieoczekiwaną zmianę wymiarów."
      );
    }
  } finally {
    decoded.close?.();
  }
}

export async function inspectSourceFile(file) {
  const source = validateSourceFile(file);
  const sourceSha256 = await sha256Blob(file);

  return Object.freeze({
    filename: source.filename,
    mimeType: source.mimeType,
    size: source.size,
    sha256: sourceSha256
  });
}

export async function convertSourceFileToAvif(
  file,
  {
    encoderLoader = loadAvifEncoder,
    verifyOutput = true,
    sourceInspection = null,
    decoder = decodeSource
  } = {}
) {
  const source = sourceInspection || await inspectSourceFile(file);

  if (
    !source ||
    typeof source.filename !== "string" ||
    typeof source.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(source.sha256)
  ) {
    throw new AvifConversionError(
      "SOURCE_INSPECTION_INVALID",
      "Wynik wstępnej analizy pliku jest nieprawidłowy."
    );
  }

  if (typeof decoder !== "function") {
    throw new AvifConversionError(
      "SOURCE_DECODER_INVALID",
      "Brak prawidłowego dekodera obrazu."
    );
  }

  let decoded = null;
  try {
    decoded = await decoder(file);

    const width = Number(decoded?.width ?? decoded?.naturalWidth);
    const height = Number(decoded?.height ?? decoded?.naturalHeight);
    validateDimensions(width, height);

    // Existing AVIF files are already the desired storage format. Re-encoding
    // them would be slower and could reduce quality. Keep the exact source bytes.
    if (source.mimeType === "image/avif") {
      const avifBlob = file.type === "image/avif"
        ? file
        : file.slice(0, file.size, "image/avif");

      return Object.freeze({
        source: Object.freeze({
          filename: source.filename,
          mimeType: source.mimeType,
          size: source.size,
          sha256: source.sha256
        }),
        output: Object.freeze({
          blob: avifBlob,
          mimeType: "image/avif",
          size: avifBlob.size,
          sha256: source.sha256,
          width,
          height,
          passthrough: true
        })
      });
    }

    const { context } = createCanvas(width, height);
    context.drawImage(decoded, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);

    const avifBlob = await encodeImageDataToAvif(imageData, { encoderLoader });

    if (verifyOutput) {
      await verifyAvifBlob(avifBlob, width, height);
    }

    const avifSha256 = await sha256Blob(avifBlob);

    return Object.freeze({
      source: Object.freeze({
        filename: source.filename,
        mimeType: source.mimeType,
        size: source.size,
        sha256: source.sha256
      }),
      output: Object.freeze({
        blob: avifBlob,
        mimeType: "image/avif",
        size: avifBlob.size,
        sha256: avifSha256,
        width,
        height,
        passthrough: false
      })
    });
  } catch (error) {
    if (error instanceof AvifConversionError) throw error;
    throw new AvifConversionError(
      "AVIF_CONVERSION_FAILED",
      "Nie udało się przygotować obrazu do AVIF.",
      { cause: error }
    );
  } finally {
    decoded?.close?.();
  }
}

export async function createInventoryPreviewAvif(
  productionAvifBlob,
  {
    encoderLoader = loadAvifEncoder,
    verifyOutput = true,
    decoder = decodeSource,
    maxWidth = INVENTORY_PREVIEW_MAX_WIDTH,
    maxHeight = INVENTORY_PREVIEW_MAX_HEIGHT
  } = {}
) {
  if (!(productionAvifBlob instanceof Blob) || productionAvifBlob.type !== "image/avif" || productionAvifBlob.size <= 0) {
    throw new AvifConversionError(
      "PREVIEW_SOURCE_INVALID",
      "Nie udało się przygotować obrazu do wyświetlenia w bibliotece."
    );
  }

  if (typeof decoder !== "function") {
    throw new AvifConversionError(
      "PREVIEW_DECODER_INVALID",
      "Brak prawidłowego dekodera obrazu."
    );
  }

  let decoded = null;
  try {
    decoded = await decoder(productionAvifBlob);
    const width = Number(decoded?.width ?? decoded?.naturalWidth);
    const height = Number(decoded?.height ?? decoded?.naturalHeight);
    const geometry = calculateInventoryPreviewGeometry(width, height, { maxWidth, maxHeight });

    const { context } = createCanvas(geometry.outputWidth, geometry.outputHeight);
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

    const imageData = context.getImageData(0, 0, geometry.outputWidth, geometry.outputHeight);
    const blob = await encodeImageDataToAvif(imageData, { encoderLoader });

    if (verifyOutput) {
      await verifyAvifBlob(blob, geometry.outputWidth, geometry.outputHeight);
    }

    return Object.freeze({
      blob,
      mimeType: "image/avif",
      size: blob.size,
      width: geometry.outputWidth,
      height: geometry.outputHeight
    });
  } catch (error) {
    if (error instanceof AvifConversionError) throw error;
    throw new AvifConversionError(
      "PREVIEW_CREATE_FAILED",
      "Nie udało się przygotować obrazu do wyświetlenia w bibliotece.",
      { cause: error }
    );
  } finally {
    decoded?.close?.();
  }
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
