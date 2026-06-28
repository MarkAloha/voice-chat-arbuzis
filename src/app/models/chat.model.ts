export interface ChatMessage {
    id: string;
    author: string;
    authorIdentity: string;
    text: string;
    sentAt: Date;
    isLocal: boolean;
}
