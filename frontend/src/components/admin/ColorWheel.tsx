import { Component, createEffect, createSignal, onCleanup, } from 'solid-js';
import './ColorWheel.scss';

interface ColorWheelProps {
    /** Initial color value (hex string like #ff0000 or rgb string like rgb(255,0,0)) */
    value?: string;
    /** Called whenever the color changes; provides hex and rgb */
    onChange: (color: { hex: string; rgb: { r: number; g: number; b: number; }; },) => void;
    /** Size of the SV square in pixels (default 240) */
    size?: number;
}

// ─── Color conversion utilities ───

function hexToRgb(hex: string,): { r: number; g: number; b: number; } | null {
    const m = hex.replace('#', '',);
    if (m.length === 3) {
        return {
            r: parseInt(m[0] + m[0], 16,),
            g: parseInt(m[1] + m[1], 16,),
            b: parseInt(m[2] + m[2], 16,),
        };
    }
    if (m.length === 6) {
        return {
            r: parseInt(m.substring(0, 2,), 16,),
            g: parseInt(m.substring(2, 4,), 16,),
            b: parseInt(m.substring(4, 6,), 16,),
        };
    }
    return null;
}

function rgbToHex(r: number, g: number, b: number,): string {
    const toHex = (n: number,) => Math.round(n,).toString(16,).padStart(2, '0',);
    return `#${toHex(r,)}${toHex(g,)}${toHex(b,)}`;
}

function rgbToHsv(r: number, g: number, b: number,): { h: number; s: number; v: number; } {
    const rN = r / 255;
    const gN = g / 255;
    const bN = b / 255;
    const max = Math.max(rN, gN, bN,);
    const min = Math.min(rN, gN, bN,);
    const d = max - min;
    let h = 0;
    const v = max;
    const s = max === 0 ? 0 : d / max;

    if (d !== 0) {
        switch (max) {
            case rN:
                h = ((gN - bN) / d + (gN < bN ? 6 : 0)) / 6;
                break;
            case gN:
                h = ((bN - rN) / d + 2) / 6;
                break;
            case bN:
                h = ((rN - gN) / d + 4) / 6;
                break;
        }
    }

    return { h: h * 360, s: s * 100, v: v * 100, };
}

function hsvToRgb(h: number, s: number, v: number,): { r: number; g: number; b: number; } {
    const hN = h / 360;
    const sN = s / 100;
    const vN = v / 100;

    const i = Math.floor(hN * 6,);
    const f = hN * 6 - i;
    const p = vN * (1 - sN);
    const q = vN * (1 - f * sN);
    const t = vN * (1 - (1 - f) * sN);

    let r = 0;
    let g = 0;
    let b = 0;
    switch (i % 6) {
        case 0:
            r = vN;
            g = t;
            b = p;
            break;
        case 1:
            r = q;
            g = vN;
            b = p;
            break;
        case 2:
            r = p;
            g = vN;
            b = t;
            break;
        case 3:
            r = p;
            g = q;
            b = vN;
            break;
        case 4:
            r = t;
            g = p;
            b = vN;
            break;
        case 5:
            r = vN;
            g = p;
            b = q;
            break;
    }

    return { r: r * 255, g: g * 255, b: b * 255, };
}

function parseColor(input: string,): { r: number; g: number; b: number; } {
    if (!input) return { r: 255, g: 0, b: 0, };
    if (input.startsWith('#',)) {
        return hexToRgb(input,) || { r: 255, g: 0, b: 0, };
    }
    const rgbMatch = input.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/,);
    if (rgbMatch) {
        return {
            r: parseInt(rgbMatch[1], 10,),
            g: parseInt(rgbMatch[2], 10,),
            b: parseInt(rgbMatch[3], 10,),
        };
    }
    return { r: 255, g: 0, b: 0, };
}

// ─── Component ───

const ColorWheel: Component<ColorWheelProps> = (props,) => {
    const size = () => props.size || 240;

    // Internal HSV state
    const [hue, setHue,] = createSignal(0,);
    const [sat, setSat,] = createSignal(100,);
    const [val, setVal,] = createSignal(100,);

    let svRef: HTMLDivElement | undefined;
    let hueRef: HTMLDivElement | undefined;
    let lastEmitted = '';

    // Initialize from props.value
    createEffect(() => {
        const v = props.value;
        if (!v) return;
        const rgb = parseColor(v,);
        const hex = rgbToHex(rgb.r, rgb.g, rgb.b,);
        if (hex === lastEmitted) return; // Avoid feedback loop
        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b,);
        setHue(hsv.h,);
        setSat(hsv.s,);
        setVal(hsv.v,);
    },);

    const currentRgb = () => hsvToRgb(hue(), sat(), val(),);
    const currentHex = () => {
        const rgb = currentRgb();
        return rgbToHex(rgb.r, rgb.g, rgb.b,);
    };

    // Emit changes
    createEffect(() => {
        const hex = currentHex();
        const rgb = currentRgb();
        if (hex !== lastEmitted) {
            lastEmitted = hex;
            props.onChange({
                hex,
                rgb: {
                    r: Math.round(rgb.r,),
                    g: Math.round(rgb.g,),
                    b: Math.round(rgb.b,),
                },
            },);
        }
    },);

    // ─── SV square interactions ───

    const updateSV = (clientX: number, clientY: number,) => {
        if (!svRef) return;
        const rect = svRef.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width,),);
        const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height,),);
        setSat(x * 100,);
        setVal((1 - y) * 100,);
    };

    const handleSVPointerDown = (e: PointerEvent,) => {
        e.preventDefault();
        updateSV(e.clientX, e.clientY,);
        const handleMove = (ev: PointerEvent,) => updateSV(ev.clientX, ev.clientY,);
        const handleUp = () => {
            document.removeEventListener('pointermove', handleMove,);
            document.removeEventListener('pointerup', handleUp,);
        };
        document.addEventListener('pointermove', handleMove,);
        document.addEventListener('pointerup', handleUp,);
        onCleanup(() => {
            document.removeEventListener('pointermove', handleMove,);
            document.removeEventListener('pointerup', handleUp,);
        },);
    };

    // ─── Hue slider interactions ───

    const updateHue = (clientX: number,) => {
        if (!hueRef) return;
        const rect = hueRef.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width,),);
        setHue(x * 360,);
    };

    const handleHuePointerDown = (e: PointerEvent,) => {
        e.preventDefault();
        updateHue(e.clientX,);
        const handleMove = (ev: PointerEvent,) => updateHue(ev.clientX,);
        const handleUp = () => {
            document.removeEventListener('pointermove', handleMove,);
            document.removeEventListener('pointerup', handleUp,);
        };
        document.addEventListener('pointermove', handleMove,);
        document.addEventListener('pointerup', handleUp,);
        onCleanup(() => {
            document.removeEventListener('pointermove', handleMove,);
            document.removeEventListener('pointerup', handleUp,);
        },);
    };

    return (
        <div class="color-wheel" style={{ width: `${size()}px`, }}>
            <div
                ref={svRef}
                class="color-wheel__sv"
                style={{
                    width: `${size()}px`,
                    height: `${size()}px`,
                    'background-color': `hsl(${hue()}, 100%, 50%)`,
                }}
                onPointerDown={handleSVPointerDown}
            >
                <div class="color-wheel__sv-white" />
                <div class="color-wheel__sv-black" />
                <div
                    class="color-wheel__sv-thumb"
                    style={{
                        left: `${sat()}%`,
                        top: `${100 - val()}%`,
                    }}
                />
            </div>

            <div
                ref={hueRef}
                class="color-wheel__hue"
                onPointerDown={handleHuePointerDown}
            >
                <div
                    class="color-wheel__hue-thumb"
                    style={{ left: `${(hue() / 360) * 100}%`, }}
                />
            </div>

            <div class="color-wheel__preview-row">
                <div class="color-wheel__preview" style={{ background: currentHex(), }} />
                <span class="color-wheel__hex">{currentHex()}</span>
            </div>
        </div>
    );
};

export default ColorWheel;
