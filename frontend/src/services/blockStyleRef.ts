/**
 * Shared kernel for converting between the editor's `styleRef`
 * representation and the persisted `block.style` shape.
 *
 * The CMS stores block styling in a single `style` JSONB column,
 * holding either:
 *   - `{ id: <uuid> }` — reference to a row in `block_styles`
 *   - flat custom props (`{ backgroundColor, padding, … }`)
 *
 * The editor models this as `BlockData.styleRef`:
 *   - `{ templateId: <uuid> }`  — picker selected a saved style
 *   - `{ custom: { …props } }`  — operator set inline overrides
 *
 * On every picker action the editor writes the new selection to
 * `block.data.__styleRef`. Persistence converters across all three
 * surfaces (PageEditor, PostEditor, MailTemplate/MailSend) need the
 * exact same logic to read `__styleRef`-or-`styleRef` and produce the
 * persisted style — drifting between them is a class of bug, so the
 * kernel lives in one place.
 */

export interface StyleRef {
    templateId?: string;
    custom?: Record<string, unknown>;
}

/** Translate a persisted block.style payload into the editor's
 *  styleRef shape. Returns `undefined` for empty/missing styles. */
export function deriveStyleRefFromStyle(
    style: Record<string, unknown> | null | undefined,
): StyleRef | undefined {
    if (!style || typeof style !== 'object') return undefined;
    if (typeof (style as { id?: unknown; }).id === 'string') {
        return { templateId: String((style as { id: unknown; }).id,), };
    }
    if (Object.keys(style,).length === 0) return undefined;
    return { custom: style, };
}

/**
 * Resolve the active styleRef for a block being saved. Mirrors the
 * "explicit override beats stored value" precedence that the editor
 * relies on: `__styleRef` from `data` (the picker's most recent
 * action) wins over the BlockData-level `styleRef` (loaded from the
 * server).
 */
export interface ResolvedRef {
    /** The active reference. `null` indicates an explicit clear
     *  (operator picked "no style"); `undefined` means no explicit
     *  override and no stored ref. */
    ref: StyleRef | null | undefined;
    explicitlyCleared: boolean;
}

export function resolveActiveStyleRef(
    data: Record<string, unknown>,
    storedRef: StyleRef | undefined,
): ResolvedRef {
    const hasExplicit = '__styleRef' in data;
    const explicit = data.__styleRef as StyleRef | null | undefined;
    const explicitlyCleared = hasExplicit && (explicit === null || explicit === undefined);
    return {
        ref: hasExplicit ? explicit : storedRef,
        explicitlyCleared,
    };
}

/**
 * Translate an active styleRef back into the persisted style payload.
 *   - `{ templateId }` → `{ id: templateId }`
 *   - `{ custom }`      → metadata-stripped flat props, or `undefined`
 *                         if the operator cleared every prop
 *   - explicit null     → caller-supplied "cleared" sentinel
 *   - missing            → `undefined`
 *
 * Returns:
 *   - a flat record (custom props) or `{ id: …}` ref to persist as-is
 *   - `null` when the operator explicitly cleared (caller decides
 *     whether to send `null` to the backend to wipe the column)
 *   - `undefined` when there's nothing to persist
 */
export function styleRefToPersistedStyle(
    resolved: ResolvedRef,
): Record<string, unknown> | null | undefined {
    if (resolved.explicitlyCleared) return null;
    const ref = resolved.ref;
    if (!ref || typeof ref !== 'object') return undefined;
    if (ref.templateId) return { id: ref.templateId, };
    if (ref.custom) {
        // Block-style templates ship with identity columns (id, name,
        // isDefault, createdAt, updatedAt). The editor sometimes
        // copies a template's body into the custom slot for tweaking
        // — strip that metadata so we only persist presentation props.
        const {
            id: _id, name: _name, isDefault: _d, createdAt: _ca, updatedAt: _ua,
            ...customProps
        } = ref.custom as Record<string, unknown>;
        return Object.keys(customProps,).length > 0 ? customProps : undefined;
    }
    return undefined;
}
