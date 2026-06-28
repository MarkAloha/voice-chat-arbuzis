function isProduction(): boolean {
    return process.env['NODE_ENV'] === 'production';
}

function requireEnv(name: string, devFallback: string): string {
    const value = process.env[name]?.trim();
    if (value) {
        return value;
    }

    if (isProduction()) {
        throw new Error(`Переменная окружения ${name} не задана.`);
    }

    return devFallback;
}

function optionalEnv(name: string, fallback: string): string {
    const value = process.env[name]?.trim();
    return value || fallback;
}

export function getConfig() {
    return {
        sitePassword: requireEnv('SITE_PASSWORD', 'dev-password'),
        livekitApiKey: requireEnv('LIVEKIT_API_KEY', 'devkey'),
        livekitApiSecret: requireEnv('LIVEKIT_API_SECRET', 'my-super-secret-key-123456789012345'),
        livekitUrl: requireEnv('LIVEKIT_URL', 'ws://localhost:7880'),
        roomName: optionalEnv('ROOM_NAME', 'main'),
    };
}
