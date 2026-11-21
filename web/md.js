// The little Markdown the tickets and the release notes are written in, drawn as elements -- never as HTML, so nothing
// in a ticket can become a tag or a script here. Headings, lists, tables, paragraphs; **bold**, *italic*, ***both***,
// `code`, ~~struck~~; a [link](url) keeps only its words (THE DASHBOARD's rule: nothing leaves the page).
import { el } from "./ui.js";

const INLINE = /(`[^`\n]+`|\*\*\*[^*\n]+?\*\*\*|\*\*[^\n]+?\*\*|\*[^*\s\n](?:[^*\n]*?[^*\s\n])?\*|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\s]+\))/;

/** One line's inline marks, as nodes. */
export function inline(text) {
  const out = [];
  for (const part of String(text).split(INLINE)) {
    if (!part) continue;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) out.push(el("code", {}, part.slice(1, -1)));
    else if (/^\*\*\*.+\*\*\*$/.test(part)) out.push(el("strong", {}, el("em", {}, inline(part.slice(3, -3)))));
    else if (/^\*\*.+\*\*$/.test(part)) out.push(el("strong", {}, inline(part.slice(2, -2))));
    else if (/^\*.+\*$/.test(part)) out.push(el("em", {}, inline(part.slice(1, -1))));
    else if (/^~~.+~~$/.test(part)) out.push(el("s", {}, inline(part.slice(2, -2))));
    else if (/^\[.+\]\(.+\)$/.test(part)) out.push(...inline(part.slice(1, part.indexOf("]("))));
    else out.push(document.createTextNode(part));
  }
  return out;
}

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** A whole text, as a fragment of blocks. */
export function md(text) {
  const frag = document.createDocumentFragment(), lines = String(text ?? "").replace(/\r/g, "").split("\n");
  let para = [], list = null;
  const flush = () => {
    if (para.length) frag.append(el("p", {}, para.flatMap((l, i) => (i ? [el("br"), ...inline(l)] : inline(l)))));
    para = [];
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], h = /^(#{1,4})\s+(.*)$/.exec(line), li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (!line.trim()) { flush(); continue; }
    if (h) { flush(); frag.append(el(`h${Math.min(6, h[1].length + 2)}`, {}, inline(h[2]))); continue; }
    if (/^\s*\|/.test(line)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).map(cells);
      const [head, ...rest] = /^\s*\|[\s:|-]+\|\s*$/.test(rows[1] ?? "") ? body : [null, ...body];
      frag.append(el("div", { class: "table" }, el("table", {},
        head && el("thead", {}, el("tr", {}, head.map((c) => el("th", {}, inline(c))))),
        el("tbody", {}, rest.map((r) => el("tr", {}, r.map((c) => el("td", {}, inline(c)))))))));
      continue;
    }
    if (li) {
      if (para.length) { frag.append(el("p", {}, para.flatMap((l, j) => (j ? [el("br"), ...inline(l)] : inline(l))))); para = []; }
      if (!list) { list = el("ul"); frag.append(list); }
      list.append(el("li", {}, inline(li[1])));
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.lastChild.append(" ", ...inline(line.trim())); continue; }
    list = null;
    para.push(line);
  }
  flush();
  return frag;
}
