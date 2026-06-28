import { ParticipantInfo, RoomServiceClient } from 'livekit-server-sdk';
import { getConfig } from './config';

/** LiveKit отдаёт 404, если комната ещё ни разу не создавалась — для нас это «0 участников». */
function isRoomNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /not found|does not exist|404|requested entity was not found/i.test(message);
}

function createRoomService(): RoomServiceClient {
    const config = getConfig();
    return new RoomServiceClient(
        config.livekitApiUrl,
        config.livekitApiKey,
        config.livekitApiSecret,
    );
}

export async function listRoomParticipants(): Promise<ParticipantInfo[]> {
    const config = getConfig();
    const roomService = createRoomService();

    try {
        return await roomService.listParticipants(config.roomName);
    } catch (error) {
        if (isRoomNotFoundError(error)) {
            return [];
        }

        throw error;
    }
}

/** Создаёт комнату или пересоздаёт с новым maxParticipants, когда в ней никого нет. */
export async function ensureRoomParticipantLimit(maxParticipants: number): Promise<void> {
    const config = getConfig();
    const roomService = createRoomService();
    const rooms = await roomService.listRooms([config.roomName]);

    if (rooms.length === 0) {
        await roomService.createRoom({
            name: config.roomName,
            maxParticipants,
            emptyTimeout: 600,
            departureTimeout: 120,
        });
        return;
    }

    const room = rooms[0];
    const currentMax = room.maxParticipants ?? 0;
    const activeParticipants = room.numParticipants ?? 0;

    if (currentMax === maxParticipants) {
        return;
    }

    // LiveKit не умеет менять maxParticipants на лету — только delete + create на пустой комнате.
    if (activeParticipants > 0) {
        return;
    }

    await roomService.deleteRoom(config.roomName);
    await roomService.createRoom({
        name: config.roomName,
        maxParticipants,
        emptyTimeout: 600,
        departureTimeout: 120,
    });
}

export async function getRoomParticipantCount(): Promise<number> {
    const participants = await listRoomParticipants();
    return participants.length;
}
