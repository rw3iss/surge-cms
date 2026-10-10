import { describe, expect, it, } from 'vitest';
import { replyRecipient, type ReplyRecipientInput, } from './replyRecipient';

const base: ReplyRecipientInput = {
    reply: { authorId: 'u2', status: 'visible', targetType: 'post', parentId: 'c1', },
    parent: { authorId: 'u1', email: 'ada@example.com', status: 'visible', },
    notifyOnReply: true,
};
const with_ = (p: Partial<{ reply: Partial<ReplyRecipientInput['reply']>; parent: Partial<NonNullable<ReplyRecipientInput['parent']>> | null; notifyOnReply: boolean; }>,): ReplyRecipientInput => ({
    reply: { ...base.reply, ...(p.reply ?? {}), },
    parent: p.parent === null ? null : { ...base.parent!, ...(p.parent ?? {}), },
    notifyOnReply: p.notifyOnReply ?? true,
});

describe('replyRecipient', () => {
    it('emails the parent comment\'s author', () => expect(replyRecipient(base,),).toBe('ada@example.com',));
    it('also for an anonymous reply', () => expect(replyRecipient(with_({ reply: { authorId: null, }, },),),).toBe('ada@example.com',));
    it('not when the setting is off', () => expect(replyRecipient(with_({ notifyOnReply: false, },),),).toBeNull());
    it('not for a pending reply', () => expect(replyRecipient(with_({ reply: { status: 'pending', }, },),),).toBeNull());
    it('not for a top-level comment', () => expect(replyRecipient(with_({ reply: { parentId: null, }, },),),).toBeNull());
    it('not for forum replies (the forum notifies itself)', () => expect(replyRecipient(with_({ reply: { targetType: 'forum_thread', }, },),),).toBeNull());
    it('not to yourself', () => expect(replyRecipient(with_({ reply: { authorId: 'u1', }, },),),).toBeNull());
    it('not to a guest or a deleted comment', () => {
        expect(replyRecipient(with_({ parent: { authorId: null, }, },),),).toBeNull();
        expect(replyRecipient(with_({ parent: { email: null, }, },),),).toBeNull();
        expect(replyRecipient(with_({ parent: { status: 'deleted', }, },),),).toBeNull();
        expect(replyRecipient(with_({ parent: null, },),),).toBeNull();
    },);
},);
