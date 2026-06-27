export const config = {
  sitePassword: process.env['SITE_PASSWORD'] ?? 'dev-password',
  livekitApiKey: process.env['LIVEKIT_API_KEY'] ?? 'devkey',
  livekitApiSecret:
    process.env['LIVEKIT_API_SECRET'] ?? 'my-super-secret-key-123456789012345',
  livekitUrl: process.env['LIVEKIT_URL'] ?? 'ws://localhost:7880',
  roomName: process.env['ROOM_NAME'] ?? 'main',
};
