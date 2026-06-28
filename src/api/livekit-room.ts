import { RoomServiceClient } from 'livekit-server-sdk';
import { getConfig } from './config';

function livekitHttpUrl(wsUrl: string): string {
    return wsUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
}

export async function getRoomParticipantCount(): Promise<number> {
    const config = getConfig();
    const host = livekitHttpUrl(config.livekitUrl);
    const roomService = new RoomServiceClient(host, config.livekitApiKey, config.livekitApiSecret);

    try {
        const participants = await roomService.listParticipants(config.roomName);
        return participants.length;
    } catch {
        return 0;
    }
}
