import { describe, expect, it, } from 'vitest';
import { COMPONENT_KIND, componentArgsFor, TEMPLATE_KIND, templateCallFor, slotVariableUse, templateRecordFor, } from './templateFunctions';

describe('templateCallFor', () => {
    it('template: ref + positional record, any order', () => {
        const p = { id: '1', title: 'Tee', };
        expect(templateCallFor('template', ['Product Card', p,], {},),).toMatchObject({ kind: TEMPLATE_KIND, ref: 'Product Card', record: p, },);
        expect(templateCallFor('template', [p, 'Product Card',], { type: 'product', },),).toMatchObject({ ref: 'Product Card', entityType: 'product', record: p, },);
        expect(templateCallFor('template', [], { name: 'X', product: p, },),).toMatchObject({ ref: 'X', named: { product: p, }, },);
    },);
    it('component: name= / id= and the rest as named', () => {
        const c = templateCallFor('component', [], { id: 'abc', events: [], layout: 'column', },);
        expect(c,).toMatchObject({ kind: COMPONENT_KIND, ref: 'abc', named: { events: [], layout: 'column', }, },);
    },);
    it('no ref → empty (caller reports the error)', () => {
        expect(templateCallFor('component', [5,], {},).ref,).toBe('',);
    },);
},);

describe('componentArgsFor', () => {
    const slots = [{ id: 'events', array: true, }, { id: 'lead', array: false, },];
    it('slots normalised to shape, other args become string props', () => {
        const a = { id: 'a', }, b = { id: 'b', };
        const out = componentArgsFor(slots, { events: a, lead: [b, a,], layout: 'column', count: 3, junk: { x: 1, }, },);
        expect(out.values,).toEqual({ events: [a,], lead: b, },);
        expect(out.props,).toEqual({ layout: 'column', count: '3', },);
    },);
    it('unwraps entity refs passed as values', () => {
        const out = componentArgsFor(slots, { events: [{ __entity: true, kind: 'event', data: { id: 'e', }, },], },);
        expect(out.values.events,).toEqual([{ id: 'e', },],);
    },);
},);

describe('templateRecordFor', () => {
    it('record=, positional, or the singular var', () => {
        const p = { id: 'p', };
        expect(templateRecordFor(templateCallFor('template', ['T',], { product: p, },), { singularVar: 'product', },).record,).toBe(p,);
        expect(templateRecordFor(templateCallFor('template', ['T', p,], {},), {},).records,).toEqual([p,],);
        expect(templateRecordFor(templateCallFor('template', ['T',], {},), {},).record,).toBeNull();
    },);
},);

describe('slotVariableUse', () => {
    const slots = [{ id: 'events', }, { id: 'hero', }, { id: 'eventsArchive', },];
    it('names only slots the text mentions as a whole word', () => {
        const u = slotVariableUse(slots, '{{ for events as e }}{{ e.title }}{{ endfor }}',);
        expect(u.slots.map((s,) => s.id,),).toEqual(['events',],);
        expect(u.props,).toBe(false,);
    },);
    it('ignores a property access with the same name and text without {{', () => {
        expect(slotVariableUse(slots, '{{ item.hero }}',).slots,).toEqual([],);
        expect(slotVariableUse(slots, 'events and hero',).slots,).toEqual([],);
    },);
    it('detects props', () => {
        expect(slotVariableUse(slots, '{{ props.layout }}',).props,).toBe(true,);
        expect(slotVariableUse(slots, '{{ item.props }}',).props,).toBe(false,);
    },);
},);
