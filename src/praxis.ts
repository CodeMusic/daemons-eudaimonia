// E-9: PRAXIS's engine, @daemons/praxis, pinned by tag (package.json). It is TypeScript source whose files import each
// other as ./x.js, and Node strips types only outside node_modules -- so this file teaches Node to load it, with no
// package of its own: inside the engine, each ./x.js is read as its x.ts, and its types are stripped as it loads (the
// engine writes only syntax a stripper can erase, v0.3.1). Everything here imports PRAXIS from this file, never from
// the package itself, so the hooks are in place before the engine is.
import { existsSync, readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import type * as Engine from "@daemons/praxis";

const PKG = "/node_modules/@daemons/praxis/";

registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes(PKG) && specifier.startsWith(".") && specifier.endsWith(".js")) {
      const ts = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(ts))) return { url: ts.href, format: "module", shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.includes(PKG) && url.endsWith(".ts")) {
      const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { sourceUrl: url });
      return { format: "module", source, shortCircuit: true };
    }
    return next(url, context);
  },
});

/** the engine: its Praxis, push(), local() and the rest, loaded through the hooks above */
export const px: typeof Engine = await import("@daemons/praxis");
export type { Db, Entry, Form, Have, Item, KindDef, Note, Peer, Praxis, PxEvent, Reach, Received, Space, StateDef } from "@daemons/praxis";
