/**
 * The entity as last saved: the loaded row with the fields of the saves since
 * merged over it (later saves win). Pure, so it is unit-testable
 * without the editor's DOM dependencies.
 */
export function mergeSaved<T>(loaded: T | null, fields: Record<string, unknown> | null,): T | null {
    if (!loaded) return fields ? fields as T : null;
    return fields ? { ...loaded, ...fields, } : loaded;
}
