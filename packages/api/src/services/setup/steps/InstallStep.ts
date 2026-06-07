import type { Pool, } from 'pg';
import type { InstallInput, } from '../types';
import type { EnvFileStore, } from '../stores/envFileStore';

/**
 * Open-Closed seam: each section of the wizard maps to one InstallStep
 * file. The installer iterates a static list of steps; adding a new
 * section means adding a new step + its validator + its frontend
 * component. No central code changes.
 */

export interface InstallContext {
    /** The validated wizard input. */
    input: InstallInput;
    /** Env values accumulated by earlier steps; flushed to disk by envWriteStep last. */
    envBuffer: EnvFileStore;
    /** Lazily set by databaseStep once a usable connection exists. */
    pool?: Pool;
    /** Set by adminUserStep when an admin is created or detected. */
    adminId?: string;
    /** Free-form scratch space for steps that need to remember rollback info. */
    scratch: Record<string, unknown>;
}

export interface InstallStepError {
    section: string;
    field?: string;
    message: string;
    code?: string;
}

export interface InstallStep {
    readonly id: string;
    readonly section: string;
    isApplicable(ctx: InstallContext,): boolean;
    execute(ctx: InstallContext,): Promise<void>;
    rollback?(ctx: InstallContext,): Promise<void>;
}
