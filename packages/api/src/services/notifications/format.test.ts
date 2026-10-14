import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('../../config', () => ({ config: { frontendUrl: 'https://cfg.example', }, }),);

import { renderNotification, subscriptionStatusLabel, type NotifyPerson, } from './format';

const person: NotifyPerson = {
    userId: 'u1', name: 'Jane <b>Doe</b>', email: 'jane@example.com', phone: '555-0100',
    roles: ['subscriber', 'ambassador',], membership: { level: 'Founders', status: 'Active', renews: 'Renews Nov 1, 2026', },
    joined: 'Jan 2, 2026', adminUrl: '/admin/users/u1',
};

describe('renderNotification', () => {
    it('escapes every visitor-supplied value in the HTML', () => {
        const out = renderNotification({
            title: 'New <script>',
            intro: 'Hi & "bye"',
            person,
            sections: [{ heading: 'Answers', rows: [{ label: 'Why<', value: '<img src=x onerror=alert(1)>', },], text: 'a\nb', },],
            baseUrl: 'https://site.example',
        },);
        expect(out.html,).not.toContain('<script>',);
        expect(out.html,).not.toContain('<img',);
        expect(out.html,).not.toContain('<b>Doe</b>',);
        expect(out.html,).toContain('New &lt;script&gt;',);
        expect(out.html,).toContain('Jane &lt;b&gt;Doe&lt;/b&gt;',);
        expect(out.html,).toContain('Why&lt;',);
        expect(out.html,).toContain('Hi &amp; &quot;bye&quot;',);
        expect(out.subject,).toBe('New <script>',);
    },);

    it('makes links absolute and renders them as buttons + text lines', () => {
        const out = renderNotification({
            title: 'T',
            links: [{ label: 'View member', url: '/admin/users/u1', }, { label: 'Stripe', url: 'https://dashboard.stripe.com/x', },],
            baseUrl: 'https://site.example/',
        },);
        expect(out.html,).toContain('href="https://site.example/admin/users/u1"',);
        expect(out.html,).toContain('href="https://dashboard.stripe.com/x"',);
        expect(out.text,).toContain('View member: https://site.example/admin/users/u1',);
        expect(out.text,).toContain('Stripe: https://dashboard.stripe.com/x',);
    },);

    it('falls back to the configured frontend URL', () => {
        const out = renderNotification({ title: 'T', links: [{ label: 'Go', url: '/admin', },], },);
        expect(out.text,).toContain('Go: https://cfg.example/admin',);
    },);

    it('mirrors the person + sections in the text part and skips empty rows', () => {
        const out = renderNotification({
            title: 'Membership started',
            person,
            sections: [{ heading: 'Membership', rows: [{ label: 'Level', value: 'Founders', }, { label: 'Empty', value: '', }, { label: 'Null', value: null, },], },],
            baseUrl: 'https://s',
        },);
        expect(out.text,).toContain('== Member ==',);
        expect(out.text,).toContain('Name: Jane <b>Doe</b>',);
        expect(out.text,).toContain('Roles: subscriber, ambassador',);
        expect(out.text,).toContain('Membership: Founders · Active · Renews Nov 1, 2026',);
        expect(out.text,).toContain('Level: Founders',);
        expect(out.text,).not.toContain('Empty',);
        expect(out.html,).not.toContain('Null',);
    },);

    it('marks an account-less person', () => {
        const out = renderNotification({
            title: 'T',
            person: { ...person, userId: null, name: null, roles: [], membership: null, joined: null, adminUrl: null, phone: null, },
            baseUrl: 'https://s',
        },);
        expect(out.text,).toContain('Email: jane@example.com',);
        expect(out.text,).toContain('Account: No account yet',);
    },);
},);

describe('subscriptionStatusLabel', () => {
    it('says incomplete is awaiting payment', () => {
        expect(subscriptionStatusLabel('incomplete',),).toBe('Awaiting first payment',);
        expect(subscriptionStatusLabel('past_due',),).toMatch(/payment failed/,);
    },);
},);
