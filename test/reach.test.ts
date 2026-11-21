// Who may reach the site, and what counts as home (the first password's door).
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowed, home, ourHost } from "../src/reach.ts";

test("this machine, a home network and the tailnet are allowed; the rest is not", () => {
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.0.0.136", "172.16.4.2", "192.168.1.9", "100.101.102.103",
                   "fd7a:115c:a1e0::1", "fe80::1%en0", "::ffff:192.168.0.2"])
    assert.equal(allowed(a), true, a);
  for (const a of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:4860:4860::8888", "::ffff:8.8.8.8", "", undefined, "nonsense"])
    assert.equal(allowed(a as string), false, String(a));
});

test("a Host or Origin must be this machine's kind of name", () => {
  for (const h of ["localhost:4741", "127.0.0.1:4741", "[::1]:4741", "m2cbook.local", "mac.taile54412.ts.net:4741", "mac", undefined])
    assert.equal(ourHost(h as string), true, String(h));
  for (const h of ["evil.example.com", "http://evil.example.com", "null", "localhost.evil.com"])
    assert.equal(ourHost(h), false, h);
});

test("home is an allowed socket that no proxy carried", () => {
  assert.equal(home("127.0.0.1", {}), true);
  assert.equal(home("127.0.0.1", { "x-forwarded-for": "8.8.8.8" }), false);
  assert.equal(home("10.0.0.150", { forwarded: "for=8.8.8.8" }), false);
  assert.equal(home("8.8.8.8", {}), false);
});
