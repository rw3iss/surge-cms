import { describe, expect, it, vi, } from 'vitest';

vi.mock('../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);
const { applicantName, } = await import('./membershipApplications');

describe('applicantName', () => {
    it('prefers the name given in the application', () => {
        expect(applicantName({ answers: [{ label: 'Name', value: 'Ann Lee', field: 'name', },], user: { displayName: 'annl', }, },),).toBe('Ann Lee',);
    },);
    it('reads a labelled answer from an older row, joining first + last', () => {
        expect(applicantName({ answers: [{ label: 'First name', value: 'Ann', }, { label: 'Last name', value: 'Lee', },], },),).toBe('Ann Lee',);
    },);
    it('falls back to the account, else empty', () => {
        expect(applicantName({ answers: [{ label: 'Occupation', value: 'Writer', },], user: { displayName: 'Ann', }, },),).toBe('Ann',);
        expect(applicantName({ answers: [], user: null, },),).toBe('',);
    },);
},);
