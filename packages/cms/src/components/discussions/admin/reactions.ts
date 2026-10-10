/** "👍 ❤️, 😂" → ['👍','❤️','😂']: split on whitespace/commas, de-duplicated, order kept. */
export function parseReactions(text: string,): string[] {
    return [...new Set(text.split(/[\s,]+/,).map((s,) => s.trim()).filter(Boolean,),),];
}
