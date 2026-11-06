import { describe, expect, it, } from 'vitest';
import { formContactValues, guessContactField, } from './formContact';

describe('guessContactField', () => {
    it.each([
        ['Email address', null, 'email',], ['Your e-mail', null, 'email',], ['Work', 'email', 'email',],
        ['Phone number', null, 'phone',], ['Mobile (optional)', null, 'phone',], ['Contact', 'phone', 'phone',],
        ['First name (optional)', null, 'first_name',], ['Given name', null, 'first_name',],
        ['Last name', null, 'last_name',], ['Surname', null, 'last_name',],
        ['Name', null, 'name',], ['Your name', null, 'name',], ['Full name', null, 'name',],
        ['Company name', null, null,], ['Occupation', null, null,], ['Name of your organization', null, null,],
        // Labels ABOUT email / phone, and choice / date questions, are not contact fields.
        ['Email preferences', 'text', null,], ['Preferred contact method: email or phone', 'radio', null,],
        ['Email', 'checkbox', null,], ['Phone type', 'select', null,], ['Newsletter by email?', 'text', null,],
        ['Name', 'date', null,], ['Phone', 'number', 'phone',], ['Name', 'number', null,], ['Email', 'textarea', 'email',],
    ] as const)('%s → %s', (label, type, want,) => {
        expect(guessContactField(label, type,),).toBe(want,);
    },);
},);

describe('formContactValues', () => {
    const answers = [
        { questionId: 'a', value: 'ann@example.com', }, { questionId: 'b', value: 'Ann', },
        { questionId: 'c', value: 'Lee', }, { questionId: 'd', value: '555-1234', }, { questionId: 'e', value: 'boss@x.com', },
    ];
    it('reads by label, joining first + last', () => {
        const q = [{ id: 'a', question: 'Email', }, { id: 'b', question: 'First name', }, { id: 'c', question: 'Last name', }, { id: 'd', question: 'Phone', },];
        expect(formContactValues(q, answers,),).toEqual({ email: 'ann@example.com', name: 'Ann Lee', firstName: 'Ann', lastName: 'Lee', phone: '555-1234', },);
    },);
    it('an explicit contact field wins over a label guess', () => {
        const q = [{ id: 'e', question: 'Your manager', contactField: 'email' as const, }, { id: 'a', question: 'Email', },];
        expect(formContactValues(q, answers,).email,).toBe('boss@x.com',);
    },);
    it('missing answers are null', () => {
        expect(formContactValues([{ id: 'z', question: 'Email', },], answers,).email,).toBeNull();
    },);
},);

describe('snapshotContactValues', () => {
    it('uses the recorded field, else the label', async () => {
        const { snapshotContactValues, } = await import('./formContact');
        expect(snapshotContactValues([{ label: 'Who are you?', value: 'Ann Lee', field: 'name', }, { label: 'E-mail', value: 'a@x.com', },],),)
            .toMatchObject({ name: 'Ann Lee', email: 'a@x.com', },);
        expect(snapshotContactValues([{ label: 'Occupation', value: 'Writer', },],).name,).toBeNull();
    },);
},);

describe('formContactValues — email must be an address', () => {
    it('a non-address answer to the email question is no email', () => {
        expect(formContactValues([{ id: 'a', question: 'Email', },], [{ questionId: 'a', value: 'call me', },],).email,).toBeNull();
    },);
    it('a choice question labelled Email does not shadow the real email question', () => {
        const q = [{ id: 'p', question: 'Email preferences', type: 'radio', }, { id: 'a', question: 'Your email', type: 'text', },];
        expect(formContactValues(q, [{ questionId: 'p', value: 'Weekly', }, { questionId: 'a', value: 'ann@x.com', },],).email,).toBe('ann@x.com',);
    },);
},);

describe('contactQuestions — explicit field on a choice question', () => {
    it('is ignored (a legacy backfill could set one)', async () => {
        const { contactQuestions, } = await import('./formContact');
        const q = [{ id: 'p', question: 'Email preferences', type: 'radio', contactField: 'email' as const, }, { id: 'a', question: 'Email', type: 'email', },];
        expect(contactQuestions(q,).email?.id,).toBe('a',);
    },);
},);

