type NoiseWorkletModule = typeof import('@workadventure/noise-suppression/audio-worklet');
type NoiseWorkletHandle = Awaited<
    ReturnType<NoiseWorkletModule['createNoiseSuppressionAudioWorklet']>
>;
type CreateOptions = NonNullable<Parameters<NoiseWorkletModule['createNoiseSuppressionAudioWorklet']>[1]>;

const WASM_ROOT = '/vendor/litert/';

/** ng serve prebundle ломает URL к WASM (отдаёт HTML); подменяем на /vendor/litert/*. */
function patchWasmFetch<T>(run: () => Promise<T>): Promise<T> {
    const originalFetch = globalThis.fetch.bind(globalThis);

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

        if (url.includes('.wasm')) {
            const fileName = url.split('/').pop();
            if (fileName?.endsWith('.wasm')) {
                return originalFetch(`${WASM_ROOT}${fileName}`, init);
            }
        }

        return originalFetch(input, init);
    }) as typeof fetch;

    return run().finally(() => {
        globalThis.fetch = originalFetch;
    });
}

let modulePromise: Promise<NoiseWorkletModule> | null = null;

function loadModule(): Promise<NoiseWorkletModule> {
    modulePromise ??= import('@workadventure/noise-suppression/audio-worklet');
    return modulePromise;
}

export function createNoiseSuppressionWorklet(
    context: AudioContext,
    options?: CreateOptions,
): Promise<NoiseWorkletHandle> {
    return patchWasmFetch(async () => {
        const { createNoiseSuppressionAudioWorklet } = await loadModule();
        return createNoiseSuppressionAudioWorklet(context, options);
    });
}
