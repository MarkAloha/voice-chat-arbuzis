function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function getConfig() {
  return {
    sitePassword: env('SITE_PASSWORD', 'dev-password'),
    livekitApiKey: env('LIVEKIT_API_KEY', 'devkey'),
    livekitApiSecret: env(
      'LIVEKIT_API_SECRET',
      'my-super-secret-key-123456789012345',
    ),
    livekitUrl: env('LIVEKIT_URL', 'ws://localhost:7880'),
    roomName: env('ROOM_NAME', 'main'),
  };
}
