/**
 * AI-written lesson and question HTML is untrusted. Only these tags, without attributes, survive; everything else
 * (including any other tag, attribute, entity trick or script) is escaped to inert text.
 */
const ALLOWED = /^<\/?(b|i|br|ul|li|sub|sup)\s*\/?>$/i;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function sanitizeHtml(input: string): string {
  return String(input).split(/(<[^<>]*>)/g).map((part) => {
    if (part.startsWith("<") && part.endsWith(">")) return ALLOWED.test(part) ? part.toLowerCase().replace(/\s+/g, "").replace("<br/>", "<br>") : esc(part);
    return esc(part).replace(/&amp;(amp|lt|gt|quot);/g, "&$1;");
  }).join("");
}

export const stripHtml = (h: string) => h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
