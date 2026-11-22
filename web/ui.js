// The front page's helpers, shared by app.js (the accounts), egg.js (THE EASTER EGG), dashboard.js and spaces.js.
export const $ = (id) => document.getElementById(id);

/** A call to this site's API, as JSON; an answer that is not OK throws its own words. */
export async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {},
                                body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(v.error || `The server said ${r.status}.`);
  return v;
}

/** An element: props (class, on<event>, attributes; false and null skipped) and children (false and null skipped). */
export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

/** how long ago, in words: "just now", "5 min ago", "3 h ago", "2 days ago" */
export const ago = (iso) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago`
    : `${Math.round(s / 86400)} days ago`;
};
/** a day, short: "21 Nov" */
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** a progress bar: how much of a whole is closed */
export function bar(closed, all, label = "closed") {
  const pc = all ? Math.round((100 * closed) / all) : 0;
  const b = el("span", { class: "bar", role: "img", "aria-label": `${pc}% ${label}` }, el("span", {}));
  b.firstChild.style.width = `${pc}%`;
  return b;
}
