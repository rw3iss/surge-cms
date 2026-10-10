/**
 * Pure dependency validator. Given a desired toggle change and current
 * state, computes an ordered plan of feature flips that respects
 * prerequisites + dependents — or refuses with a structured error the
 * UI can use to render a confirmation modal.
 *
 * No DB access. Trivially unit-testable. The caller (PUT /settings)
 * decides whether to retry with `enableDependencies`/`disableDependents`
 * based on the refusal kind.
 */
import { FEATURE_REGISTRY, FeatureKey, getDependents, } from './registry';

export interface PlanStep { key: FeatureKey; enabled: boolean; }

export type ValidationResult =
    | { ok: true; plan: PlanStep[]; }
    | { ok: false; kind: 'missing_prerequisites'; target: FeatureKey; missing: FeatureKey[]; }
    | { ok: false; kind: 'has_dependents'; target: FeatureKey; dependents: FeatureKey[]; };

export interface ValidateOpts {
    enableDependencies?: boolean;
    disableDependents?: boolean;
}

export function validateEnable(
    target: Partial<Record<FeatureKey, boolean>>,
    current: Record<FeatureKey, boolean>,
    opts: ValidateOpts = {},
): ValidationResult {
    const plan: PlanStep[] = [];
    const projected = { ...current, };

    for (const [k, desired,] of Object.entries(target,) as [FeatureKey, boolean][]) {
        if (projected[k] === desired) continue;

        if (desired === true) {
            const missingAll = (FEATURE_REGISTRY[k].requires ?? []).filter((r,) => !projected[r],);
            // Hidden base features (e.g. `discussions`) are enabled silently —
            // the operator never chose them, so never asks about them. Their
            // OWN prerequisites still go through the normal check below.
            const hidden = missingAll.filter((r,) => FEATURE_REGISTRY[r].hidden,);
            const missing = [
                ...missingAll.filter((r,) => !FEATURE_REGISTRY[r].hidden,),
                ...hidden.flatMap((h,) => (FEATURE_REGISTRY[h].requires ?? []).filter((r,) => !projected[r],)),
            ].filter((r, i, all,) => all.indexOf(r,) === i);
            if (missing.length > 0) {
                if (!opts.enableDependencies) {
                    return { ok: false, kind: 'missing_prerequisites', target: k, missing, };
                }
                for (const m of missing) {
                    plan.push({ key: m, enabled: true, },);
                    projected[m] = true;
                }
            }
            for (const h of hidden) {
                plan.push({ key: h, enabled: true, },);
                projected[h] = true;
            }
            plan.push({ key: k, enabled: true, },);
            projected[k] = true;
        } else {
            const dependents = getDependents(k,).filter((d,) => projected[d],);
            if (dependents.length > 0) {
                if (!opts.disableDependents) {
                    return { ok: false, kind: 'has_dependents', target: k, dependents, };
                }
                for (const d of dependents) {
                    plan.push({ key: d, enabled: false, },);
                    projected[d] = false;
                }
            }
            plan.push({ key: k, enabled: false, },);
            projected[k] = false;
        }
    }

    return { ok: true, plan, };
}
