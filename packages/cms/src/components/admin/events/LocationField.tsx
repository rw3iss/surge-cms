/**
 * The event Location field with an optional map picker.
 *
 *   - Type an address or venue → "Pick on map" opens a map that searches it
 *     (on open, and whenever the text is committed — blur / Enter) and drops the
 *     pin on the best match; other matches are listed to choose from.
 *   - Drag the pin or click the map → the pin moves there and the text becomes
 *     the address found at that point (else its coordinates).
 *   - The point is stored with the text (lat / lng); "Show map on the event
 *     page" puts a small map there.
 *   - "Set text": a Location label shown on the site INSTEAD of the location
 *     text (e.g. "Main Hall" for a pin's street address). Maps and "View map"
 *     still use the location + its point.
 *
 * Lookups go through `cms.geo` (OpenStreetMap, proxied + cached server-side).
 * The map itself is `components/map/LocationMap` — the provider seam.
 */
import type { GeoPlace, } from '@sitesurge/types';
import { formatLatLng, } from '@sitesurge/types';
import { type Component, createEffect, createSignal, For, lazy, on, Show, Suspense, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';
import { CommitInput, } from '../forms/CommitInput';
import type { PendingLookups, } from './pendingLookups';
import './LocationField.scss';

const LocationMap = lazy(() => import('../../map/LocationMap'),);

export interface LocationFieldProps {
    location: string;
    lat: number | null;
    lng: number | null;
    showMap: boolean;
    /** Text shown instead of the location on the site; null = none. */
    label: string | null;
    onLabel: (label: string | null,) => void;
    onLocation: (text: string,) => void;
    onPoint: (lat: number | null, lng: number | null,) => void;
    onShowMap: (on: boolean,) => void;
    /** Running lookups are tracked here, so the form's Save can wait for them (see pendingLookups.ts). */
    lookups?: PendingLookups;
}

const LocationField: Component<LocationFieldProps> = (props,) => {
    const [open, setOpen,] = createSignal(false,);
    // "Set text" — on while a label exists; switching it off drops the label.
    const [labelOn, setLabelOn,] = createSignal(Boolean(props.label?.trim(),),);
    createEffect(on(() => props.label, (l,) => { if (l?.trim()) setLabelOn(true,); },),);
    const [busy, setBusy,] = createSignal(false,);
    const [matches, setMatches,] = createSignal<GeoPlace[]>([],);
    const [error, setError,] = createSignal('',);
    /** The address could not be placed on the map (cleared whenever a position is set). */
    const [unlocated, setUnlocated,] = createSignal(false,);
    const hasPoint = () => props.lat != null && props.lng != null;
    const setPoint = (lat: number | null, lng: number | null,) => {
        props.onPoint(lat, lng,);
        if (lat != null) setUnlocated(false,);
    };

    // Only the LATEST lookup may apply its result: a slow search that answers
    // after the pin was dragged (or another search) must not move the pin back.
    let seq = 0;
    const begin = () => { seq += 1; setBusy(true,); return seq; };
    const current = (n: number,) => n === seq;
    const tracked = <T,>(p: Promise<T>,): Promise<T> => props.lookups?.track(p,) ?? p;

    /** Search the text and drop the pin on the best match (the text is kept). */
    const searchText = async (text: string,) => {
        const q = text.trim();
        setMatches([],);
        setError('',);
        if (q.length < 3) {
            seq += 1; // cancel any lookup still running
            setBusy(false,);
            return;
        }
        const n = begin();
        try {
            const found = await tracked(cms.geo.search(q, 5,),);
            if (!current(n,)) return;
            setMatches(open() && found.length > 1 ? found : [],);
            if (found[0]) setPoint(found[0].lat, found[0].lng,);
            else setUnlocated(true,);
        } catch (e) {
            if (current(n,)) setError((e as Error).message || 'The map search failed.',);
        } finally {
            if (current(n,)) setBusy(false,);
        }
    };

    /** The pin moved: the text becomes the address there (else its coordinates). */
    const picked = async (lat: number, lng: number,) => {
        setPoint(lat, lng,);
        setMatches([],);
        setError('',);
        const n = begin();
        let text = formatLatLng(lat, lng,);
        try {
            const place = await tracked(cms.geo.reverse(lat, lng,),);
            if (place) text = place.shortLabel || place.label;
        } catch {
            // Keep the coordinates as the text.
        }
        if (!current(n,)) return;
        props.onLocation(text,);
        setBusy(false,);
    };

    const choose = (p: GeoPlace,) => {
        seq += 1;
        setBusy(false,);
        props.onLocation(p.shortLabel || p.label,);
        setPoint(p.lat, p.lng,);
        setMatches([],);
    };

    const clearPin = () => {
        seq += 1;
        setBusy(false,);
        props.onPoint(null, null,);
    };

    const toggle = () => {
        const next = !open();
        setOpen(next,);
        if (next && !hasPoint() && props.location.trim()) void searchText(props.location,);
    };

    return (
        <div class="location-field">
            <FormField
                label="Location"
                tooltip="An address or venue. Pick on map to set its exact point: the map searches what you type, and dragging the pin (or clicking the map) fills in the address found there."
            >
                <div class="location-field__row">
                    <CommitInput
                        value={props.location}
                        placeholder="Philadelphia City Hall, Philadelphia, PA"
                        onCommit={(v,) => {
                            const changed = v.trim() !== props.location.trim();
                            props.onLocation(v,);
                            // A new address moves the point when it matters: the map is open,
                            // the event shows a map, or a point was set for the old text.
                            if (changed && (open() || props.showMap || hasPoint())) void searchText(v,);
                            if (!v.trim()) setUnlocated(false,);
                        }}
                    />
                    <Toggle
                        class="location-field__label-switch"
                        size="sm"
                        checked={labelOn()}
                        onChange={(v,) => { setLabelOn(v,); if (!v) props.onLabel(null,); }}
                        label="Set text"
                    />
                    <button type="button" class="ui-button ui-button--sm ui-button--secondary" aria-expanded={open()} onClick={toggle}>
                        {open() ? 'Hide map' : hasPoint() ? 'Edit on map' : 'Pick on map'}
                    </button>
                </div>
            </FormField>

            <Show when={labelOn()}>
                <FormField
                    label="Location label"
                    tooltip="Shown on the event page, event cards and emails instead of the location above (e.g. “Main Hall” or “The usual spot”). The map and View map still go to the location."
                >
                    <CommitInput
                        value={props.label ?? ''}
                        placeholder="e.g. Main Hall, Philadelphia City Hall"
                        onCommit={(v,) => props.onLabel(v.trim() || null,)}
                    />
                </FormField>
            </Show>

            <Show when={open()}>
                <div class="location-field__panel">
                    <Show when={matches().length}>
                        <div class="location-field__matches" role="group" aria-label="Other matches">
                            <span class="location-field__hint">Other matches:</span>
                            <For each={matches()}>
                                {(m,) => (
                                    <button type="button" class="location-field__match" onClick={() => choose(m,)} title={m.label}>
                                        {m.shortLabel || m.label}
                                    </button>
                                )}
                            </For>
                        </div>
                    </Show>
                    <Suspense fallback={<div class="location-field__map-loading" style={{ height: '280px', }}>Loading map…</div>}>
                        <LocationMap
                            lat={props.lat}
                            lng={props.lng}
                            draggable
                            onPick={(lat, lng,) => void picked(lat, lng,)}
                            height="280px"
                            label="Event location map"
                        />
                    </Suspense>
                    <div class="location-field__meta">
                        <span class="location-field__hint">
                            {busy() ? 'Looking up…' : hasPoint()
                                ? <>Pin: {formatLatLng(props.lat!, props.lng!,)} — drag it or click the map to move it (keyboard: arrows pan, Enter drops it at the center).</>
                                : 'Type an address above, or click the map to drop the pin.'}
                        </span>
                        <Show when={hasPoint()}>
                            <button type="button" class="ui-button ui-button--sm ui-button--ghost" onClick={clearPin}>
                                Clear pin
                            </button>
                        </Show>
                    </div>
                </div>
            </Show>
            {/* Outside the panel: a background lookup (Show a map, a changed address) reports here too. */}
            <Show when={!open() && busy()}>
                <p class="location-field__hint" role="status">Looking up the address on the map…</p>
            </Show>
            <Show when={error()}><p class="location-field__error" role="alert">{error()}</p></Show>

            <Toggle
                checked={props.showMap}
                onChange={(v,) => {
                    props.onShowMap(v,);
                    // No point yet: place the typed address now (the map need not be open).
                    if (v && !hasPoint() && props.location.trim()) void searchText(props.location,);
                }}
                label="Show a map on the event page"
                hint="A small map above the sign-up box (clicking it opens Google Maps). It shows once the location has a point on the map — set from the address, or picked with Pick on map."
            />
            <Show when={unlocated() && props.location.trim()}>
                <p class="location-field__warning" role="status">
                    Couldn't locate “{props.location.trim()}” on the map. Use Pick on map to drag the pin to the place{hasPoint() ? ' (the current pin was kept)' : ''}, or adjust the address.
                </p>
            </Show>
            <Show when={props.showMap && !hasPoint() && !props.location.trim()}>
                <p class="location-field__hint">Enter a location (or pick one on the map) for the map to show.</p>
            </Show>
        </div>
    );
};

export default LocationField;
