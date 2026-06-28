import { ParticipantInfo, RoomServiceClient } from 'livekit-server-sdk';
import { getConfig } from './config';

function livekitHttpUrl(wsUrl: string): string {
    return wsUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
}

function createRoomService(): RoomServiceClient {
    const config = getConfig();
    const host = livekitHttpUrl(config.livekitUrl);
    return new RoomServiceClient(host, config.livekitApiKey, config.livekitApiSecret);
}

export async function listRoomParticipants(): Promise<ParticipantInfo[]> {
    const config = getConfig();
    const roomService = createRoomService();

    try {
        return await roomService.listParticipants(config.roomName);
    } catch {
        return [];
    }
}

export async function getRoomParticipantCount(): Promise<number> {
    const participants = await listRoomParticipants();
    return participants.length;
}
