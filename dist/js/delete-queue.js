export class DeleteDrainCoordinator {
  constructor({
    keyOf = (item) => item?.id,
    processItem,
    reconcile,
    isFatalError = () => false,
    onWorkerStart = () => {},
    onWorkerIdle = () => {},
    onPhaseChange = () => {},
    onItemStart = () => {},
    onItemSuccess = () => {},
    onItemFailure = () => {},
    onReconcileFailure = () => {},
    onFatal = () => {}
  } = {}) {
    if (typeof processItem !== "function") throw new TypeError("processItem must be a function");
    if (typeof reconcile !== "function") throw new TypeError("reconcile must be a function");

    this.keyOf = keyOf;
    this.processItem = processItem;
    this.reconcile = reconcile;
    this.isFatalError = isFatalError;
    this.onWorkerStart = onWorkerStart;
    this.onWorkerIdle = onWorkerIdle;
    this.onPhaseChange = onPhaseChange;
    this.onItemStart = onItemStart;
    this.onItemSuccess = onItemSuccess;
    this.onItemFailure = onItemFailure;
    this.onReconcileFailure = onReconcileFailure;
    this.onFatal = onFatal;

    this.queue = [];
    this.ownedKeys = new Set();
    this.workerPromise = null;
    this.phase = "idle";
  }

  enqueue(item) {
    const key = this.keyOf(item);
    if (key === undefined || key === null || key === "") {
      throw new TypeError("queued delete item must expose a stable key");
    }

    if (this.ownedKeys.has(key)) return false;

    this.queue.push(item);
    this.ownedKeys.add(key);
    this.#ensureWorker();
    return true;
  }

  has(key) {
    return this.ownedKeys.has(key);
  }

  pendingCount() {
    return this.queue.length;
  }

  snapshot() {
    return Object.freeze({
      phase: this.phase,
      pendingCount: this.queue.length,
      ownedCount: this.ownedKeys.size,
      workerActive: Boolean(this.workerPromise)
    });
  }

  async whenIdle() {
    while (true) {
      const activeWorker = this.workerPromise;
      if (activeWorker) await activeWorker;
      await Promise.resolve();

      if (!this.workerPromise && this.queue.length === 0 && this.ownedKeys.size === 0) return;
    }
  }

  #setPhase(nextPhase) {
    if (this.phase === nextPhase) return;
    this.phase = nextPhase;
    this.onPhaseChange(nextPhase, this.snapshot());
  }

  #ensureWorker() {
    if (this.workerPromise) return this.workerPromise;

    let runResult = Object.freeze({ fatal: false, error: null });
    const run = this.#runWorker().then((result) => {
      runResult = result;
      return result;
    });
    let trackedPromise;
    trackedPromise = run.finally(() => {
      if (this.workerPromise === trackedPromise) this.workerPromise = null;
      this.#setPhase("idle");
      this.onWorkerIdle(runResult, this.snapshot());

      // Belt-and-suspenders invariant: an item accepted during final promise
      // settlement must never remain stranded without an owning worker.
      if (!runResult.fatal && this.queue.length > 0) this.#ensureWorker();
    });

    this.workerPromise = trackedPromise;
    return trackedPromise;
  }

  async #runWorker() {
    this.onWorkerStart(this.snapshot());
    let fatalError = null;

    workerLoop:
    while (true) {
      this.#setPhase("draining");

      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;

        const key = this.keyOf(item);
        await this.onItemStart(item, {
          pendingCount: this.queue.length,
          phase: this.phase
        });

        try {
          await this.processItem(item);
          await this.onItemSuccess(item, {
            pendingCount: this.queue.length,
            phase: this.phase
          });
        } catch (error) {
          if (this.isFatalError(error)) {
            fatalError = error;
            this.ownedKeys.delete(key);
            break workerLoop;
          }

          await this.onItemFailure(item, error, {
            pendingCount: this.queue.length,
            phase: this.phase
          });
        } finally {
          if (!fatalError) this.ownedKeys.delete(key);
        }
      }

      this.#setPhase("reconciling");

      try {
        await this.reconcile();
      } catch (error) {
        if (this.isFatalError(error)) {
          fatalError = error;
          break;
        }

        await this.onReconcileFailure(error, this.snapshot());
      }

      // No await is allowed between this quiescence check and leaving the
      // worker loop. Any enqueue that happens while reconciliation is awaited
      // is observed here and drained by the same lifecycle.
      if (this.queue.length === 0) break;
    }

    if (fatalError) {
      const pendingItems = this.queue.splice(0);
      for (const item of pendingItems) this.ownedKeys.delete(this.keyOf(item));
      this.ownedKeys.clear();
      await this.onFatal(fatalError, { pendingItems });
      return Object.freeze({ fatal: true, error: fatalError });
    }

    return Object.freeze({ fatal: false, error: null });
  }
}
