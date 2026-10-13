export interface ChatMessage {
    id: string;
    author: string;
    authorIdentity: string;
    text: string;
    sentAt: Date;
    isLocal: boolean;
    /** Blob-адрес в памяти вкладки. На сервер картинка не пишется. */
    imageUrl?: string;
}
