// Keep the ZIP end record until its completed-byte accounting is durable. A
// failed or cancelled stream releases its hold and never emits a valid archive.
export function recordAfterZipCompletion(
  source: ReadableStream<Uint8Array>, onComplete: () => Promise<void>,
  onAbort: () => Promise<void>, timeoutMs = 240000, abortSource?: () => void,
) {
  const reader = source.getReader();
  let pending: Uint8Array | null = null, stopped = false;
  let cleanup: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout>;
  const stop = (reason: unknown) => {
    if (cleanup) return cleanup;
    stopped = true; clearTimeout(timer);
    abortSource?.();
    cleanup = (async () => {
      let cancelTimer: ReturnType<typeof setTimeout> | undefined;
      // Async generator.return() can wait behind an unresponsive body read.
      // Stop outward emission immediately and bound that cleanup independently
      // of the durable attempt release (which has its own RPC deadline).
      const cancelled = Promise.race([reader.cancel(reason), new Promise<void>(resolve => {
        cancelTimer = setTimeout(resolve, Math.min(1000, timeoutMs));
      })]).finally(() => clearTimeout(cancelTimer));
      const released = onAbort().catch(error => { console.error("[event-download-batch] quota hold expires after failed release", error); });
      await Promise.allSettled([cancelled, released]);
      reader.releaseLock();
    })();
    return cleanup;
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        const error = new Error("Gallery ZIP timed out. Please retry the download.");
        controller.error(error);
        void stop(error);
      }, timeoutMs);
    },
    async pull(controller) {
      try {
        while (!stopped) {
          const next = await reader.read();
          if (stopped) return;
          if (next.done) {
            clearTimeout(timer);
            await onComplete();
            if (stopped) return;
            if (pending) controller.enqueue(pending);
            pending = null; stopped = true; reader.releaseLock(); controller.close();
            return;
          }
          if (pending) { controller.enqueue(pending); pending = next.value; return; }
          pending = next.value;
        }
      } catch (error) {
        if (stopped) return;
        controller.error(error); await stop(error);
      }
    },
    async cancel(reason) { await stop(reason); },
  });
}
