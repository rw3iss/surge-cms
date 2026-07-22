/**
 * Re-export of the canonical `ui/Toggle`. This path is kept so the 20+ admin
 * call sites (`import Toggle from '../common/Toggle'`) are unchanged; the single
 * implementation now lives in `components/ui/Toggle` with component-scoped
 * styling that works in both the admin and setup flows.
 */
export { default, Toggle, type ToggleProps, } from '../../ui/Toggle';
