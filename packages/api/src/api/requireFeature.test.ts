import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const enabledMock = vi.fn();
vi.mock('../services/settings', () => ({ isFeatureEnabledServer: (...a: unknown[]) => enabledMock(...a,), }),);

import { requireFeature, } from './requireFeature';

function app(on: boolean,) {
    enabledMock.mockResolvedValue(on,);
    const a = express();
    a.get('/x', requireFeature('shop' as never,), (_req, res,) => res.json({ success: true, data: 'ok', }),);
    return a;
}

describe('requireFeature', () => {
    beforeEach(() => enabledMock.mockReset(),);
    it('404s when the feature is disabled', async () => {
        const res = await request(app(false,),).get('/x',);
        expect(res.status,).toBe(404,);
    },);
    it('passes when enabled', async () => {
        const res = await request(app(true,),).get('/x',);
        expect(res.status,).toBe(200,);
    },);
},);
