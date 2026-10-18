/**
 * Migration 179 (events block type) + 180 (tier description).
 *
 * 179 must add `events` to BOTH block enums, commit before using the new
 * value, and only touch legacy `event` rows when that label exists (a stock
 * install never had it — referencing it unguarded raises "invalid input value
 * for enum"). The settings conversion must match `normalizeEventsBlockSettings`
 * (`eventId` → `binding: { mode: 'list', refs: [eventId] }`).
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it, } from 'vitest';
import { normalizeEventsBlockSettings, } from '@sitesurge/types';
import { parseFeatureHeader, } from './migrator';

const read = (f: string,) => fs.readFileSync(path.resolve(__dirname, 'migrations', f,), 'utf8',);

describe('179_events_block_type.sql', () => {
    const sql = read('179_events_block_type.sql',);

    it('is core (always runs) and adds the value to both enums', () => {
        expect(parseFeatureHeader(sql,),).toBeNull();
        expect(sql,).toContain("ALTER TYPE block_type ADD VALUE IF NOT EXISTS 'events'",);
        expect(sql,).toContain("ALTER TYPE content_block_type ADD VALUE IF NOT EXISTS 'events'",);
    });

    it('commits before the conversion, which is guarded on the legacy label', () => {
        const commit = sql.indexOf('COMMIT;',);
        expect(commit,).toBeGreaterThan(sql.lastIndexOf('ADD VALUE',),);
        expect(sql.indexOf("e.enumlabel = 'event'",),).toBeGreaterThan(commit,);
        expect(sql,).toMatch(/IF has_block THEN[\s\S]*UPDATE blocks[\s\S]*WHERE type::text = 'event'/,);
        expect(sql,).toMatch(/IF has_content THEN[\s\S]*UPDATE post_content_blocks/,);
    });

    it('converts eventId into the same list binding the renderers derive', () => {
        expect(sql,).toContain("jsonb_build_object('binding', jsonb_build_object('mode', 'list',",);
        expect(normalizeEventsBlockSettings({ eventId: 'abc', },).binding,).toEqual({ mode: 'list', refs: ['abc',], },);
    });
});

describe('180_event_tier_description.sql', () => {
    it('is gated on the events feature', () => {
        const sql = read('180_event_tier_description.sql',);
        expect(parseFeatureHeader(sql,),).toBe('events',);
        expect(sql,).toContain('ADD COLUMN IF NOT EXISTS description TEXT',);
    });
});
