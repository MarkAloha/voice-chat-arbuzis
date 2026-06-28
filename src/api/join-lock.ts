let tail: Promise<void> = Promise.resolve();

export function withJoinLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn);
    tail = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}
