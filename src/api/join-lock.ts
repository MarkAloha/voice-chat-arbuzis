/** Очередь join-запросов: без неё два одновременных входа оба видят «комната пуста» и проходят лимит. */
let tail: Promise<void> = Promise.resolve();

/** Выполняет join строго по одному, сохраняя порядок FIFO. */
export function withJoinLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn);
    tail = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}
