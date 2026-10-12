import type { LiveViewer, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import {
    filterViewers, formatConnectedFor, formatCountdown, groupViewers, initialOf, isSilenced, sortViewers,
} from './liveViewersModel';

const T0 = Date.parse('2026-10-12T12:00:00Z',);
const iso = (offsetSec: number,) => new Date(T0 + offsetSec * 1000,).toISOString();

const v = (over: Partial<LiveViewer>,): LiveViewer => ({
    connId: Math.random().toString(36,),
    key: 'u:1',
    userId: '1',
    name: 'Ann',
    handle: 'ann',
    role: 'member',
    avatarUrl: null,
    anonymous: false,
    connectedAt: iso(0,),
    muted: false,
    silencedUntil: null,
    ...over,
});

describe('groupViewers', () => {
    it('collapses sockets sharing a key and keeps the earliest one', () => {
        const groups = groupViewers([
            v({ connId: 'b', connectedAt: iso(30,), muted: true, },),
            v({ connId: 'a', connectedAt: iso(10,), },),
            v({ key: 'a:x', userId: null, name: 'Guest', handle: null, role: null, anonymous: true, },),
        ],);
        expect(groups,).toHaveLength(2,);
        const ann = groups.find((g,) => g.key === 'u:1',)!;
        expect(ann.connections,).toBe(2,);
        expect(ann.viewer.connId,).toBe('a',);
        expect(ann.connectedAt,).toBe(T0 + 10_000,);
        expect(ann.muted,).toBe(true,);
    });

    it('takes the latest silence end and flags staff', () => {
        const [g,] = groupViewers([
            v({ role: 'editor', silencedUntil: iso(60,), },),
            v({ role: 'editor', silencedUntil: iso(300,), },),
        ],);
        expect(g.silencedUntil,).toBe(T0 + 300_000,);
        expect(g.staff,).toBe(true,);
    });

    it('never treats an anonymous socket as staff', () => {
        const [g,] = groupViewers([v({ key: 'a:1', anonymous: true, role: 'admin', },),],);
        expect(g.staff,).toBe(false,);
    });
});

describe('sortViewers', () => {
    it('orders staff, then members, then guests, then by connected time', () => {
        const groups = groupViewers([
            v({ key: 'a:1', anonymous: true, userId: null, role: null, connectedAt: iso(0,), },),
            v({ key: 'u:2', connectedAt: iso(20,), },),
            v({ key: 'u:3', connectedAt: iso(5,), },),
            v({ key: 'u:4', role: 'admin', connectedAt: iso(50,), },),
        ],);
        expect(sortViewers(groups,).map((g,) => g.key),).toEqual(['u:4', 'u:3', 'u:2', 'a:1',],);
    });
});

describe('filterViewers', () => {
    const groups = groupViewers([
        v({ key: 'u:1', name: 'Ann Lee', handle: 'annie', },),
        v({ key: 'u:2', name: 'Bob', handle: 'bobby', },),
    ],);
    it('matches name or handle, ignoring case and a leading @', () => {
        expect(filterViewers(groups, 'LEE',).map((g,) => g.key),).toEqual(['u:1',],);
        expect(filterViewers(groups, '@bob',).map((g,) => g.key),).toEqual(['u:2',],);
        expect(filterViewers(groups, '  ',),).toHaveLength(2,);
    });
});

describe('time labels', () => {
    it('formats the silence countdown', () => {
        expect(formatCountdown(T0 + 292_000, T0,),).toBe('4:52',);
        expect(formatCountdown(T0 + 3_725_000, T0,),).toBe('1:02:05',);
        expect(formatCountdown(T0 - 1000, T0,),).toBe('',);
        expect(formatCountdown(null, T0,),).toBe('',);
    });

    it('formats connected-for', () => {
        expect(formatConnectedFor(T0, T0 + 12_000,),).toBe('12s',);
        expect(formatConnectedFor(T0, T0 + 180_000,),).toBe('3m',);
        expect(formatConnectedFor(T0, T0 + 3_900_000,),).toBe('1h 5m',);
        expect(formatConnectedFor(T0, T0 + 7_200_000,),).toBe('2h',);
    });

    it('isSilenced + initialOf', () => {
        const [g,] = groupViewers([v({ silencedUntil: iso(10,), },),],);
        expect(isSilenced(g, T0,),).toBe(true,);
        expect(isSilenced(g, T0 + 11_000,),).toBe(false,);
        expect(initialOf(' zed',),).toBe('Z',);
        expect(initialOf('',),).toBe('?',);
    });
});
