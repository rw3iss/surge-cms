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
