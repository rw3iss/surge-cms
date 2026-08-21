/**
 * Calendar grid geometry.
 *
 * The implementation lives in `@sitesurge/types` so the API's occurrence
 * expander and this SPA share ONE definition. Re-exported here so calendar
 * components keep a local, obvious import path.
 */
export {
    dateKey,
    GRID_DAYS,
    gridStart,
    MONTHS,
    monthGridDays,
    monthGridWindow,
    stepMonth,
    WEEKDAYS,
    yearOptions,
} from '@sitesurge/types';
