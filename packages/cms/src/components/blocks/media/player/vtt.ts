/**
 * WebVTT thumbnail sprites for the seek-bar preview.
 *
 * Each cue's payload is an image URL, usually with a media-fragment crop
 * (`sprite.jpg#xywh=0,0,160,90`, optionally `#xywh=pixel:…`). Relative URLs
 * resolve against the VTT file's own URL. Parsed maps are cached per URL.
 */

export interface ThumbCue {
    start: number;
    end: number;
    /** Absolute image URL, fragment stripped. */
    url: string;
    x: number;
    y: number;
    /** 0 when the cue names a whole image (no `#xywh=`). */
    w: number;
    h: number;
}

/** `hh:mm:ss.mmm`, `mm:ss.mmm` (`,` accepted as the decimal mark) → seconds. NaN when malformed. */
export function parseVttTime(raw: string,): number {
    const parts = raw.trim().replace(',', '.',).split(':',);
    if (parts.length < 2 || parts.length > 3) return Number.NaN;
    let total = 0;
    for (const p of parts) {
        if (!/^\d+(\.\d+)?$/.test(p,)) return Number.NaN;
        total = total * 60 + Number(p,);
    }
    return total;
}

function resolveUrl(ref: string, base: string,): string {
    try {
        const origin = typeof location !== 'undefined' ? location.href : 'http://localhost/';
        return new URL(ref, new URL(base, origin,),).href;
    } catch {
        return ref;
    }
}

export function parseThumbnailsVtt(text: string, baseUrl: string,): ThumbCue[] {
    const lines = text.replace(/\r\n?/g, '\n',).split('\n',);
    const cues: ThumbCue[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('-->',)) continue;
        const [a, rest = '',] = line.split('-->',);
        const start = parseVttTime(a,);
        const end = parseVttTime(rest.trim().split(/\s+/,)[0] ?? '',);
        if (Number.isNaN(start,) || Number.isNaN(end,)) continue;
        // The payload is the next non-empty line.
        let payload = '';
        while (++i < lines.length) {
            if (lines[i].trim()) {
                payload = lines[i].trim();
                break;
            }
        }
        if (!payload) continue;
        const hashAt = payload.indexOf('#',);
        const ref = hashAt >= 0 ? payload.slice(0, hashAt,) : payload;
        const frag = hashAt >= 0 ? payload.slice(hashAt + 1,) : '';
        const m = /xywh=(?:pixel:)?(\d+),(\d+),(\d+),(\d+)/.exec(frag,);
        cues.push({
            start,
            end,
            url: resolveUrl(ref, baseUrl,),
            x: m ? Number(m[1],) : 0,
            y: m ? Number(m[2],) : 0,
            w: m ? Number(m[3],) : 0,
            h: m ? Number(m[4],) : 0,
        },);
    }
    return cues.toSorted((p, q,) => p.start - q.start);
}

/** The cue covering `t` (binary search over start-sorted cues). */
export function findCue(cues: readonly ThumbCue[], t: number,): ThumbCue | null {
    let lo = 0;
    let hi = cues.length - 1;
    let hit = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cues[mid].start <= t) {
            hit = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (hit < 0) return null;
    const c = cues[hit];
    return t < c.end || hit === cues.length - 1 ? c : null;
}

const cache = new Map<string, Promise<ThumbCue[]>>();

/** Fetch + parse a thumbnails VTT once per URL. A failed load resolves `[]` and is not cached. */
export function loadThumbnails(url: string,): Promise<ThumbCue[]> {
    let p = cache.get(url,);
    if (!p) {
        p = fetch(url, { credentials: 'same-origin', },)
            .then((r,) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status,),),)))
            .then((text,) => parseThumbnailsVtt(text, url,))
            .catch(() => {
                cache.delete(url,);
                return [];
            },);
        cache.set(url, p,);
    }
    return p;
}
