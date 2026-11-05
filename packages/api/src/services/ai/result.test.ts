import { describe, expect, it, } from 'vitest';
import { failedResult, fromBrokerJob, isDegenerateOutput, normalizeStatus, parseJsonLoose, } from './result';

const job = (over: Record<string, unknown> = {},) => ({
    id: 'j1', status: 'completed', sessionId: 's1', sessionLabel: 'general-1', pool: 'general', text: '', result: null, error: null,
    createdAt: '2026-11-05T00:00:00Z', completedAt: '2026-11-05T00:00:05Z', ...over,
});

describe('parseJsonLoose', () => {
    it('parses plain, fenced and embedded JSON', () => {
        expect(parseJsonLoose('{"a":1}',),).toEqual({ a: 1, },);
        expect(parseJsonLoose('```json\n[1,2]\n```',),).toEqual([1, 2,],);
        expect(parseJsonLoose('Here you go: {"ok":true} — done.',),).toEqual({ ok: true, },);
        expect(parseJsonLoose('no json here',),).toBeNull();
        expect(parseJsonLoose({ x: 1, },),).toEqual({ x: 1, },);
    },);
});

describe('isDegenerateOutput', () => {
    it('flags repetition loops, passes normal text', () => {
        expect(isDegenerateOutput(Array(30,).fill('court',).join(' ',),),).toBe(true,);
        expect(isDegenerateOutput('A short answer.',),).toBe(false,);
        expect(isDegenerateOutput('The quick brown fox jumps over the lazy dog while the cat watches from the warm windowsill.',),).toBe(false,);
    },);
});

describe('fromBrokerJob', () => {
    it('builds the standard result', () => {
        const r = fromBrokerJob(job({ text: 'pong', },),);
        expect(r,).toMatchObject({ id: 'j1', provider: 'broker', status: 'completed', text: 'pong', data: null, pool: 'general', model: 'general-1', timedOut: false, },);
    },);

    it('parses JSON for format=json and fails when it is not JSON', () => {
        expect(fromBrokerJob(job({ text: '```json\n{"n":2}\n```', },), 'json',).data,).toEqual({ n: 2, },);
        const bad = fromBrokerJob(job({ text: 'sorry', },), 'json',);
        expect(bad.status,).toBe('failed',);
        expect(bad.error,).toMatch(/JSON/,);
    },);

    it('keeps an object result as data', () => {
        expect(fromBrokerJob(job({ result: { answer: 'x', }, text: '{"answer":"x"}', },),).data,).toEqual({ answer: 'x', },);
    },);

    it('marks a still-running wait as timed out, and hides text until completed', () => {
        const r = fromBrokerJob(job({ status: 'in_progress', timedOut: true, text: 'partial', },),);
        expect(r,).toMatchObject({ status: 'in_progress', timedOut: true, text: '', },);
    },);

    it('maps broker statuses', () => {
        expect(normalizeStatus('dispatched',),).toBe('pending',);
        expect(normalizeStatus('orphaned',),).toBe('failed',);
        expect(normalizeStatus('weird',),).toBe('pending',);
        expect(failedResult('anthropic', 'nope',).status,).toBe('failed',);
    },);
});
