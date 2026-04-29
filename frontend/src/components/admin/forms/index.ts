/**
 * Shared admin form primitives.
 *
 * Use these instead of hand-rolled `<div class="form-group">` or
 * one-off label classes when building admin editors. They share a
 * single source of truth for label typography and spacing so every
 * editor reads consistently:
 *
 *   <FormField label="Slug" hint="lowercase, no spaces">
 *     <input ... />
 *   </FormField>
 *
 *   <FormField label="Use as homepage" inline>
 *     <select ... />
 *   </FormField>
 *
 *   <FormSection title="Show fields" tight padded>
 *     <FormCheck label="Excerpt" checked={...} onChange={...} plain />
 *     <FormCheck label="Tags" checked={...} onChange={...} plain />
 *   </FormSection>
 *
 * SCSS lives in `forms.scss`, imported once at app bootstrap so the
 * primitives don't redeclare styles per consumer.
 */
import './forms.scss';

export { default as FormField, } from './FormField';
export type { FormFieldProps, } from './FormField';

export { default as FormCheck, } from './FormCheck';
export type { FormCheckProps, } from './FormCheck';

export { default as FormSection, } from './FormSection';
export type { FormSectionProps, } from './FormSection';
