export interface JoinSession {
  token: string;
  livekitUrl: string;
  roomName: string;
  identity: string;
  displayName: string;
}

export interface JoinRequest {
  password: string;
  nickname: string;
}

export interface JoinResponse extends JoinSession {}

export interface ApiError {
  error: string;
}
