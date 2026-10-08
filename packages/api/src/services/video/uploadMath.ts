/**
 * Pure multipart part-size math for direct uploads.
 *
 * S3/R2 rules: every part except the last is ≥ 5 MiB, a part is ≤ 5 GiB and an
 * upload has ≤ 10,000 parts. The operator's `partSizeMb` is the starting
 * point; it is raised (to a whole MiB) when the file would otherwise need
 * more than 10,000 parts.
 */
export const MIB = 1024 * 1024;
export const MIN_PART_SIZE = 5 * MIB;
export const MAX_PART_SIZE = 5 * 1024 * MIB;
export const MAX_PARTS = 10_000;

export interface PartPlan {
    partSize: number;
    partCount: number;
}

export function planParts(size: number, partSizeMb: number,): PartPlan {
    if (!Number.isFinite(size,) || size <= 0) throw new RangeError('size must be > 0',);
    let partSize = Math.max(MIN_PART_SIZE, Math.round((Number.isFinite(partSizeMb,) ? partSizeMb : 64) * MIB,),);
    if (Math.ceil(size / partSize,) > MAX_PARTS) {
        partSize = Math.ceil(size / MAX_PARTS / MIB,) * MIB;
    }
    partSize = Math.min(partSize, MAX_PART_SIZE,);
    if (size <= partSize) return { partSize, partCount: 1, };
    return { partSize, partCount: Math.ceil(size / partSize,), };
}

/** Expected byte length of part `n` (1-based). */
export function expectedPartBytes(size: number, plan: PartPlan, n: number,): number {
    if (n < plan.partCount) return plan.partSize;
    return size - plan.partSize * (plan.partCount - 1);
}
