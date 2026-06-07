export type MessageStatus = 'unread' | 'read' | 'replied' | 'archived' | 'spam';

export interface ContactMessage {
    id: string;
    name: string;
    email: string;
    subject?: string;
    message: string;
    userId?: string;
    ipAddress: string;
    userAgent?: string;
    status: MessageStatus;
    repliedAt?: Date;
    repliedBy?: string;
    createdAt: Date;
}

export interface ContactMessageInput {
    name: string;
    email: string;
    subject?: string;
    message: string;
}

export interface MessageFilters {
    status?: MessageStatus;
    search?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
}
