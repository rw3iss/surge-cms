import { type Component, createMemo, createSignal, For, Show, } from 'solid-js';
import './LineChart.scss';

export interface LinePoint {
    date: string;
    value: number;
}

export interface ChartMarker {
    date: string;
    label: string;
}

interface LineChartProps {
    points: LinePoint[];
    /** Vertical notes (definition changes, "data starts here"). */
    markers?: ChartMarker[];
    height?: number;
    format?: (v: number,) => string;
    emptyText?: string;
    /** What the chart shows ("Instagram — Views"): its accessible name. */
    label?: string;
}

const W = 640;
const PAD = { top: 12, right: 12, bottom: 24, left: 52, };

const dayMs = (d: string,) => Date.parse(`${d}T00:00:00Z`,);

/**
 * A small dependency-free SVG line chart (one series, hover read-out, date markers).
 * Accessible: the SVG is named with a text summary (range, latest, high, low),
 * and is focusable — ←/→ (Home/End) step through the days, read out in a live region.
 */
const LineChart: Component<LineChartProps> = (props,) => {
    const h = () => props.height ?? 200;
    const fmt = (v: number,) => (props.format ? props.format(v,) : v.toLocaleString());
    const [hover, setHover,] = createSignal<number | null>(null,);

    const geo = createMemo(() => {
        const pts = props.points;
        if (!pts.length) return null;
        const xs = pts.map((p,) => dayMs(p.date,));
        const minX = Math.min(...xs,);
        const maxX = Math.max(...xs,);
        const vals = pts.map((p,) => p.value);
        let minY = Math.min(0, ...vals,);
        let maxY = Math.max(...vals,);
        if (maxY === minY) maxY = minY + 1;
        // A little headroom so the line doesn't touch the top.
        maxY += (maxY - minY) * 0.08;
        const iw = W - PAD.left - PAD.right;
        const ih = h() - PAD.top - PAD.bottom;
        const x = (t: number,) => PAD.left + (maxX === minX ? iw / 2 : ((t - minX) / (maxX - minX)) * iw);
        const y = (v: number,) => PAD.top + ih - ((v - minY) / (maxY - minY)) * ih;
        const line = pts.map((p, i,) => `${i ? 'L' : 'M'}${x(xs[i],).toFixed(1,)},${y(p.value,).toFixed(1,)}`).join(' ',);
        const area = `${line} L${x(xs[xs.length - 1],).toFixed(1,)},${y(minY,).toFixed(1,)} L${x(xs[0],).toFixed(1,)},${y(minY,).toFixed(1,)} Z`;
        const ticks = [0, 0.5, 1,].map((f,) => minY + (maxY - minY) * f);
        const markers = (props.markers ?? [])
            .filter((m,) => dayMs(m.date,) >= minX && dayMs(m.date,) <= maxX)
            .map((m,) => ({ ...m, x: x(dayMs(m.date,),), }));
        return { xs, x, y, line, area, ticks, markers, minX, maxX, };
    },);

    const summary = createMemo(() => {
        const pts = props.points;
        if (!pts.length) return '';
        const vals = pts.map((p,) => p.value);
        const last = pts[pts.length - 1];
        return `${props.label ? `${props.label}: ` : ''}${pts.length} day${pts.length === 1 ? '' : 's'} from ${pts[0].date} to ${last.date}. `
            + `Latest ${fmt(last.value,)}, high ${fmt(Math.max(...vals,),)}, low ${fmt(Math.min(...vals,),)}.`;
    },);

    const onKey = (e: KeyboardEvent,) => {
        const n = props.points.length;
        if (!n) return;
        const cur = hover();
        let next: number | null = cur;
        if (e.key === 'ArrowRight') next = cur === null ? 0 : Math.min(n - 1, cur + 1,);
        else if (e.key === 'ArrowLeft') next = cur === null ? n - 1 : Math.max(0, cur - 1,);
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = n - 1;
        else if (e.key === 'Escape') next = null;
        else return;
        e.preventDefault();
        setHover(next,);
    };
    const readout = () => {
        const i = hover();
        const p = i === null ? null : props.points[i];
        return p ? `${p.date}: ${fmt(p.value,)}` : '';
    };

    const onMove = (e: MouseEvent,) => {
        const g = geo();
        if (!g) return;
        const svg = e.currentTarget as SVGSVGElement;
        const rect = svg.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        let best = 0;
        let dist = Infinity;
        g.xs.forEach((t, i,) => {
            const d = Math.abs(g.x(t,) - px,);
            if (d < dist) {
                dist = d;
                best = i;
            }
        },);
        setHover(best,);
    };

    return (
        <div class="line-chart">
            <Show when={geo()} fallback={<div class="line-chart__empty">{props.emptyText ?? 'No data for this period yet.'}</div>}>
                {(g,) => (
                    <svg
                        viewBox={`0 0 ${W} ${h()}`}
                        class="line-chart__svg"
                        onMouseMove={onMove}
                        onMouseLeave={() => setHover(null,)}
                        onKeyDown={onKey}
                        onBlur={() => setHover(null,)}
                        tabIndex={0}
                        role="img"
                        aria-label={summary()}
                    >
                        <For each={g().ticks}>
                            {(t,) => (
                                <>
                                    <line class="line-chart__grid" x1={PAD.left} x2={W - PAD.right} y1={g().y(t,)} y2={g().y(t,)} />
                                    <text class="line-chart__tick" x={PAD.left - 6} y={g().y(t,) + 4} text-anchor="end">{fmt(Math.round(t,),)}</text>
                                </>
                            )}
                        </For>
                        <text class="line-chart__tick" x={PAD.left} y={h() - 6}>{props.points[0].date}</text>
                        <text class="line-chart__tick" x={W - PAD.right} y={h() - 6} text-anchor="end">{props.points[props.points.length - 1].date}</text>
                        <For each={g().markers}>
                            {(m,) => (
                                <g class="line-chart__marker">
                                    <line x1={m.x} x2={m.x} y1={PAD.top} y2={h() - PAD.bottom} />
                                    <title>{`${m.date}: ${m.label}`}</title>
                                    <circle cx={m.x} cy={PAD.top + 3} r="3" />
                                </g>
                            )}
                        </For>
                        <path class="line-chart__area" d={g().area} />
                        <path class="line-chart__line" d={g().line} />
                        <Show when={hover() !== null}>
                            {(() => {
                                const i = Math.min(hover()!, props.points.length - 1,);
                                const p = props.points[i];
                                const cx = g().x(g().xs[i],);
                                const cy = g().y(p.value,);
                                const left = cx > W * 0.7;
                                return (
                                    <g class="line-chart__hover">
                                        <line x1={cx} x2={cx} y1={PAD.top} y2={h() - PAD.bottom} />
                                        <circle cx={cx} cy={cy} r="4" />
                                        <text x={left ? cx - 8 : cx + 8} y={PAD.top + 12} text-anchor={left ? 'end' : 'start'}>
                                            {`${p.date} · ${fmt(p.value,)}`}
                                        </text>
                                    </g>
                                );
                            })()}
                        </Show>
                    </svg>
                )}
            </Show>
            <span class="line-chart__sr" aria-live="polite">{readout()}</span>
            <Show when={geo()?.markers.length}>
                <ul class="line-chart__notes">
                    <For each={geo()!.markers}>
                        {(m,) => <li><span class="line-chart__note-dot" />{m.date}: {m.label}</li>}
                    </For>
                </ul>
            </Show>
        </div>
    );
};

export default LineChart;
