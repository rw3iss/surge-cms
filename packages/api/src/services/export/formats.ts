/**
 * Output formats for an `ExportDataset`: a streamed CSV download and a
 * standalone printable HTML page (no site/admin shell — just a heading and
 * the table, styled for paper).
 */
import type { Response, } from 'express';
import { escapeHtml, } from '../../utils/html';
import { cellText, type ExportColumn, type ExportDataset, } from './dataset';

/** File-name-safe stem. */
export function fileStem(title: string,): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-',).replace(/^-|-$/g, '',).slice(0, 80,) || 'export';
}

/**
 * CSV cell: RFC 4180 quoting, and spreadsheet formula injection neutralised —
 * a value starting with = + - @ (or a tab/CR) is prefixed with `'`, because a
 * donor named `=HYPERLINK(...)` would otherwise run as a formula in Excel.
 */
export function csvCell(v: unknown,): string {
    let s = cellText(v,);
    if (/^[=+\-@\t\r]/.test(s,)) s = `'${s}`;
    return /[",\r\n]/.test(s,) ? `"${s.replace(/"/g, '""',)}"` : s;
}

export function csvLine(values: unknown[],): string {
    return values.map(csvCell,).join(',',) + '\r\n';
}

/** Stream the dataset as a CSV attachment (UTF-8 with BOM so Excel reads accents). */
export function sendCsv(res: Response, ds: ExportDataset,): void {
    const name = `${fileStem(ds.title,)}-${new Date().toISOString().slice(0, 10,)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8',);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`,);
    res.setHeader('Cache-Control', 'no-store',);
    res.write('\uFEFF' + csvLine(ds.columns.map((c,) => c.label,),),);
    // Chunked so a large export never builds one giant string.
    let buf = '';
    for (const row of ds.rows) {
        buf += csvLine(ds.columns.map((c,) => row[c.key],),);
        if (buf.length > 64_000) {
            res.write(buf,);
            buf = '';
        }
    }
    res.end(buf,);
}

const PRINT_CSS = `
*{box-sizing:border-box}
body{margin:0;padding:24px;font:12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;background:#fff}
header{margin-bottom:14px;border-bottom:2px solid #111;padding-bottom:8px}
header .site{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#555}
h1{margin:2px 0 4px;font-size:18px}
header p{margin:0;color:#555}
table{width:100%;border-collapse:collapse}
thead th{text-align:left;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:#333;border-bottom:1px solid #111;padding:6px 8px;white-space:nowrap}
tbody td{padding:5px 8px;border-bottom:1px solid #ddd;vertical-align:top;word-break:break-word}
tbody tr:nth-child(even) td{background:#f7f7f7}
td.num{text-align:right;color:#777;width:1%}
footer{margin-top:12px;color:#777;font-size:10px}
@media print{body{padding:0}thead{display:table-header-group}tr{page-break-inside:avoid}tbody tr:nth-child(even) td{background:#f3f3f3;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
@page{margin:12mm}
`;

/** The printable page. `allColumns` prints every column instead of the
 *  source's basic set. */
export function renderPrintHtml(ds: ExportDataset, opts: { siteName: string; allColumns?: boolean; },): string {
    const cols: ExportColumn[] = !opts.allColumns && ds.printColumns?.length
        ? ds.columns.filter((c,) => ds.printColumns!.includes(c.key,),)
        : ds.columns;
    const generated = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', },);
    const head = cols.map((c,) => `<th>${escapeHtml(c.label,)}</th>`,).join('',);
    const body = ds.rows.map((r, i,) =>
        `<tr><td class="num">${i + 1}</td>${cols.map((c,) => `<td>${escapeHtml(cellText(r[c.key],),)}</td>`,).join('',)}</tr>`
    ).join('\n',);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>${escapeHtml(ds.title,)}</title><style>${PRINT_CSS}</style></head><body>
<header><div class="site">${escapeHtml(opts.siteName,)}</div><h1>${escapeHtml(ds.title,)}</h1>
<p>${ds.rows.length} record${ds.rows.length === 1 ? '' : 's'}${ds.subtitle ? ` · ${escapeHtml(ds.subtitle,)}` : ''} · generated ${escapeHtml(generated,)}</p></header>
<table><thead><tr><th>#</th>${head}</tr></thead><tbody>
${body || `<tr><td colspan="${cols.length + 1}">No records.</td></tr>`}
</tbody></table>
<footer>Print with your browser (Ctrl/Cmd + P).</footer>
</body></html>`;
}

export function sendPrint(res: Response, ds: ExportDataset, opts: { siteName: string; allColumns?: boolean; },): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8',);
    res.setHeader('Cache-Control', 'no-store',);
    res.send(renderPrintHtml(ds, opts,),);
}
