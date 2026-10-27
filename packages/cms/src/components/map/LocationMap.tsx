/**
 * LocationMap — a small map with one pin. THE place that knows the map
 * provider: Leaflet + OpenStreetMap tiles (free, no API key; attribution
 * shown). Swapping to another provider (Google Maps…) means changing this
 * file only — callers pass a point and get picks back.
 *
 *   Picker (event editor):  <LocationMap lat lng draggable onPick={(lat, lng) => …} />
 *                           drag the pin or click the map to move it; zoom freely.
 *   Display (event page):   <LocationMap lat lng onClick={() => open(mapUrl)} />
 *                           static pin; the whole map is one link.
 *
 * Leaflet is imported on mount (its own chunk), so pages without a map never
 * load it. The pin is a CSS `divIcon` (Leaflet's default icon images resolve
 * badly through a bundler).
 */
import type { Map as LeafletMap, Marker, } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { type Component, createEffect, on, onCleanup, onMount, } from 'solid-js';
import './LocationMap.scss';

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
/** Where an empty picker opens (the continental US). */
export const DEFAULT_MAP_CENTER = { lat: 39.5, lng: -98.35, zoom: 3, };

export interface LocationMapProps {
    lat: number | null;
    lng: number | null;
    /** Zoom when a point is shown (default 15). */
    zoom?: number;
    /** Picker: drag the pin / click the map to move it. */
    draggable?: boolean;
    onPick?: (lat: number, lng: number,) => void;
    /** Display: the map is a link (pan/zoom off). */
    onClick?: () => void;
    height?: string;
    class?: string;
    /** Accessible name of the map region. */
    label?: string;
}

const LocationMap: Component<LocationMapProps> = (props,) => {
    let el: HTMLDivElement | undefined;
    let map: LeafletMap | undefined;
    let pin: Marker | undefined;
    let L: typeof import('leaflet') | undefined;
    const has = () => props.lat != null && props.lng != null;

    const placePin = () => {
        if (!map || !L) return;
        if (!has()) {
            pin?.remove();
            pin = undefined;
            return;
        }
        const at: [number, number,] = [props.lat!, props.lng!,];
        if (!pin) {
            pin = L.marker(at, {
                draggable: Boolean(props.draggable,),
                keyboard: Boolean(props.draggable,),
                icon: L.divIcon({ className: 'location-map__pin', html: '<span></span>', iconSize: [28, 28,], iconAnchor: [14, 28,], },),
            },).addTo(map,);
            pin.on('dragend', () => {
                const p = pin!.getLatLng();
                props.onPick?.(p.lat, p.lng,);
            },);
        } else {
            pin.setLatLng(at,);
        }
    };

    onMount(async () => {
        L = await import('leaflet');
        if (!el) return;
        const interactive = Boolean(props.draggable,) || !props.onClick;
        map = L.map(el, {
            zoomControl: interactive,
            dragging: interactive,
            scrollWheelZoom: Boolean(props.draggable,),
            doubleClickZoom: interactive,
            touchZoom: interactive,
            boxZoom: false,
            keyboard: interactive,
            attributionControl: true,
        },);
        L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION, },).addTo(map,);
        if (has()) map.setView([props.lat!, props.lng!,], props.zoom ?? 15,);
        else map.setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng,], DEFAULT_MAP_CENTER.zoom,);
        placePin();
        map.on('click', (e,) => {
            if (props.draggable) props.onPick?.(e.latlng.lat, e.latlng.lng,);
            else props.onClick?.();
        },);
        // The container may have been laid out after the map measured it (a modal opening).
        requestAnimationFrame(() => map?.invalidateSize(),);
    },);

    // A new point from outside (a search result): move the pin and the view.
    createEffect(on(() => [props.lat, props.lng,] as const, ([lat, lng,],) => {
        placePin();
        if (map && lat != null && lng != null) map.setView([lat, lng,], Math.max(map.getZoom(), props.zoom ?? 15,),);
    }, { defer: true, },),);

    onCleanup(() => map?.remove(),);

    return (
        <div
            ref={el}
            class={`location-map${props.onClick && !props.draggable ? ' location-map--link' : ''}${props.class ? ` ${props.class}` : ''}`}
            style={{ height: props.height ?? '240px', }}
            role="region"
            aria-label={props.label ?? 'Map'}
        />
    );
};

export default LocationMap;
