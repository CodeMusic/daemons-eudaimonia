// The front page's three helpers, shared by app.js (the accounts) and egg.js (THE EASTER EGG).
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
