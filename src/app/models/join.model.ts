export interface JoinSession {
    token: string;
    livekitUrl: string;
    roomName: string;
    identity: string;
    displayName: string;
    colorIndex: number;
    resumeSecret: string;
}

export interface JoinRequest {
    password: string;
    nickname: string;
}

export interface ResumeJoinRequest {
    password: string;
    identity: string;
    resumeSecret: string;
}

export interface JoinResponse extends JoinSession {}

export interface ApiError {
    error: string;
    code?: 'room_full';
}

export class JoinError extends Error {
    constructor(
        message: string,
        readonly code?: ApiError['code'],
    ) {
        super(message);
        this.name = 'JoinError';
    }
}
