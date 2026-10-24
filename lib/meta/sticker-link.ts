/** An AliExpress product id in a pasted link (AliExpress or our /p page) or on its own. */
export function productIdIn(input: string): string | null {
  const m =
    input.match(/aliexpress\.[a-z.]+\/item\/(?:[^/?#]*?)(\d{6,20})\.html/i) ??
    input.match(/matzati[a-z.-]*\/p\/(\d{6,20})/i) ??
    input.trim().match(/^(\d{6,20})$/);
  return m ? m[1] : null;
}
