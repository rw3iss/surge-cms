import type { CmsClientCore, InternalRequest, } from '../core/client';
import type { MutationOptions, QueryOptions, } from '../core/types';
import { interpolatePath, } from '../core/url';

/** Base every module namespace extends. Provides typed helpers that build
 *  an InternalRequest and delegate to the core. Mutations declare the
 *  module caches they invalidate (bare module names). */
export abstract class ModuleBase {
    protected abstract readonly module: string;
    constructor(protected readonly core: CmsClientCore,) {}

    /** Cached GET. */
    protected get<T>(path: string, opts: {
        params?: Record<string, string | number>; query?: Record<string, unknown>;
        rootMounted?: boolean; raw?: boolean; options?: QueryOptions;
    } = {},): Promise<T> {
        return this.core.send<T>({
            module: this.module, method: 'GET', path: interpolatePath(path, opts.params,),
            query: opts.query, raw: opts.raw, rootMounted: opts.rootMounted, options: opts.options,
        },);
    }

    /** Mutation (POST/PUT/PATCH/DELETE). `invalidates` lists bare module
     *  names whose cached reads to drop after success. */
    protected mutate<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, opts: {
        params?: Record<string, string | number>; query?: Record<string, unknown>;
        body?: unknown; invalidates?: string[]; options?: MutationOptions;
    } = {},): Promise<T> {
        const req: InternalRequest & { invalidates?: string[]; } = {
            module: this.module, method, path: interpolatePath(path, opts.params,),
            query: opts.query, body: opts.body, options: opts.options, invalidates: opts.invalidates,
        };
        return this.core.send<T>(req,);
    }

    /** Multipart upload (FormData passes through untouched). Named
     *  `uploadForm` so module classes can expose an ergonomic public
     *  `upload(file, fields?)` without an override-signature clash. */
    protected uploadForm<T>(path: string, formData: FormData, opts: {
        params?: Record<string, string | number>; invalidates?: string[]; options?: MutationOptions;
    } = {},): Promise<T> {
        const req: InternalRequest & { invalidates?: string[]; } = {
            module: this.module, method: 'POST', path: interpolatePath(path, opts.params,),
            body: formData, options: opts.options, invalidates: opts.invalidates,
        };
        return this.core.send<T>(req,);
    }

    /** Raw text GET (XML/HTML). */
    protected rawGet(path: string, opts: { rootMounted?: boolean; options?: QueryOptions; } = {},): Promise<string> {
        return this.core.send<string>({
            module: this.module, method: 'GET', path, raw: true,
            rootMounted: opts.rootMounted, options: opts.options,
        },);
    }
}
