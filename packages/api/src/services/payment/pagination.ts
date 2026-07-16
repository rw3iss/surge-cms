export interface Paginated<T> {
    data: T[];
    meta: { page: number; limit: number; total: number; totalPages: number; };
}

export function paginate<T>(data: T[], page: number, limit: number, total: number,): Paginated<T> {
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit,), }, };
}
