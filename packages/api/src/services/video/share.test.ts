/** S6: share tokens carry the video's share epoch; bumping it revokes them. */
import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../config', () => ({ config: { jwt: { secret: 'test-secret', }, }, }),);
vi.mock('../../db', () => ({ query: vi.fn(), }),);

import crypto from 'crypto';
import { createShareToken, verifyShareToken, } from './share';

const ID = '11111111-1111-4111-8111-111111111111';

describe('share tokens', () => {
    it('a token verifies for its own epoch only', () => {
        const { token, } = createShareToken(ID, 7, 2,);
        expect(verifyShareToken(ID, token, 2,),).toBe(true,);
        expect(verifyShareToken(ID, token, 3,),).toBe(false,);
        expect(verifyShareToken(ID, token, 0,),).toBe(false,);
    });

    it('epoch 0 keeps the original format, so links issued before epochs still work', () => {
        const exp = Math.floor(Date.now() / 1000,) + 86400;
        const legacy = `${exp}.${crypto.createHmac('sha256', 'test-secret',).update(`video-share:${ID}:${exp}`,).digest('base64url',).slice(0, 32,)}`;
        expect(verifyShareToken(ID, legacy, 0,),).toBe(true,);
        // …until the first revoke.
        expect(verifyShareToken(ID, legacy, 1,),).toBe(false,);
    });

    it('cannot be moved to another video', () => {
        const { token, } = createShareToken(ID, 7, 0,);
        expect(verifyShareToken('22222222-2222-4222-8222-222222222222', token, 0,),).toBe(false,);
    });
});
