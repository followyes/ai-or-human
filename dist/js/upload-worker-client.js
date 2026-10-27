import { AvifConversionError } from "./avif-converter.js";

function defaultWorkerFactory() {
  if (typeof Worker !== "function") {
    throw new AvifConversionError(
      "UPLOAD_WORKER_UNAVAILABLE",
      "Przeglądarka nie obsługuje przygotowania obrazów w tle."
    );
  }

  return new Worker(new URL("./upload-preparation-worker.js", import.meta.url), {
    type: "module",
    name: "ai-or-human-upload-preparation"
  });
}

function workerError(code, message) {
  return new AvifConversionError(
    code || "UPLOAD_WORKER_FAILED",
    message || "Nie udało się przygotować obrazu w tle."
  );
}

export class UploadPreparationWorkerClient {
  constructor({ workerFactory = defaultWorkerFactory } = {}) {
    if (typeof workerFactory !== "function") {
      throw new TypeError("workerFactory must be a function");
    }

    this.workerFactory = workerFactory;
    this.worker = null;
    this.pending = new Map();
    this.nextRequestId = 1;
  }

  inspect(file) {
    return this.#request("inspect", { file });
  }

  async prepare(file, sourceInspection) {
    const value = await this.#request("prepare", { file, sourceInspection });
    const outputBlob = value.output.passthrough
      ? (file.type === "image/avif" ? file : file.slice(0, file.size, "image/avif"))
      : new Blob([value.output.buffer], { type: "image/avif" });
    const previewBlob = new Blob([value.preview.buffer], { type: "image/avif" });

    return Object.freeze({
      prepared: Object.freeze({
        source: Object.freeze({ ...value.source }),
        output: Object.freeze({
          blob: outputBlob,
          mimeType: "image/avif",
          size: value.output.size,
          sha256: value.output.sha256,
          width: value.output.width,
          height: value.output.height,
          passthrough: Boolean(value.output.passthrough)
        })
      }),
      inventoryPreview: Object.freeze({
        blob: previewBlob,
        mimeType: "image/avif",
        size: value.preview.size,
        width: value.preview.width,
        height: value.preview.height
      })
    });
  }

  terminate(reason = "Proces przygotowania obrazu został zakończony.") {
    const worker = this.worker;
    this.worker = null;
    worker?.terminate?.();

    if (this.pending.size) {
      const error = workerError("UPLOAD_WORKER_TERMINATED", reason);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    }
  }

  #ensureWorker() {
    if (this.worker) return this.worker;

    let worker;
    try {
      worker = this.workerFactory();
    } catch (error) {
      if (error instanceof AvifConversionError) throw error;
      throw workerError("UPLOAD_WORKER_START_FAILED", "Nie udało się uruchomić procesu przygotowania obrazu.");
    }

    worker.addEventListener("message", (event) => this.#handleMessage(event));
    worker.addEventListener("error", () => {
      this.#handleWorkerFailure(
        workerError("UPLOAD_WORKER_CRASHED", "Proces przygotowania obrazu został przerwany. Spróbuj ponownie.")
      );
    });
    worker.addEventListener("messageerror", () => {
      this.#handleWorkerFailure(
        workerError("UPLOAD_WORKER_MESSAGE_FAILED", "Nie udało się odebrać wyniku przygotowania obrazu.")
      );
    });

    this.worker = worker;
    return worker;
  }

  #request(type, payload) {
    const worker = this.#ensureWorker();
    const requestId = `upload-${this.nextRequestId++}`;

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        worker.postMessage({ requestId, type, ...payload });
      } catch (error) {
        this.pending.delete(requestId);
        reject(workerError(
          "UPLOAD_WORKER_POST_FAILED",
          error?.message || "Nie udało się przekazać obrazu do procesu przygotowania."
        ));
      }
    });
  }

  #handleMessage(event) {
    const message = event.data || {};
    const pending = this.pending.get(message.requestId);
    if (!pending) return;

    this.pending.delete(message.requestId);

    if (message.ok) {
      pending.resolve(message.value);
      return;
    }

    pending.reject(workerError(message.error?.code, message.error?.message));
  }

  #handleWorkerFailure(error) {
    const worker = this.worker;
    this.worker = null;
    worker?.terminate?.();

    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}
