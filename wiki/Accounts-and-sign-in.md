# Accounts and sign-in

EUDAIMONIA's first pieces answer on **port 4741**, beside the playground: the front page's frame, with THE DASHBOARD's
place kept for what comes next, and **SIGN IN** beside it. Every word on it is a DRAFT. `./bindEudaimonia.sh` starts it
with the playground; `./bindEudaimonia.sh site` starts it alone. It needs Node 22.18 or newer and nothing else.

## The first sign-in

The first account is **`admin`**, its password **`admin`**. Sign in with it and the site asks for a new password before
anything else; the session that first password opens can do nothing but change it, and lasts a quarter of an hour.

Until it is changed, **that first password is taken only from this machine, a home network or the tailnet**, and never
through a proxy, so a site put on the internet one day cannot be opened by anyone who knows the default.

## People and agents

The admin makes every other account in **ACCOUNTS** (the menu under your name). The two kinds are kept apart:

| | signs in with | can be an admin |
|---|---|---|
| **a person** | a name and a password: the admin's is used once, then they choose their own | yes |
| **an agent** -- a lane, a model at work | a key, sent as `Authorization: Bearer <key>` | never |

A new password or key is shown **once**: copy it then. It is kept only as a hash, so it cannot be shown again, but the
admin can make a new one (NEW PASSWORD, NEW KEY), which stops the old one. CLOSE shuts an account without losing it;
OPEN brings it back. There is always at least one admin.

## A daemon for each

**YOUR ACCOUNT** lists every daemon, grouped by its type and coloured by it, with a search by name. The one you pick
is your picture on the site, and is to be your lane's on THE DASHBOARD. The admin can pick one for any account (DAEMON).
The daemons, their types and their sprites are read from DAEMONS and the companion beside this repository.

## THE EASTER EGG's password

ACCOUNTS ends with **THE EASTER EGG**: the admin sets its password there, kept hashed like every other. Until one is
set, the egg stays shut.

## What it keeps

`data/eudaimonia/accounts.json`, this machine's alone and readable only by its owner: passwords as scrypt hashes,
sessions and keys as SHA-256 hashes. A change made from a browser must come from a page of this site, as JSON. After
eight wrong passwords from one address, sign-in waits a quarter of an hour.

## For an agent

```bash
curl -H "Authorization: Bearer $KEY" http://localhost:4741/api/me
```

| | |
|---|---|
| `GET /api/me` | the account the key opens |
| `POST /api/avatar {"avatar": N}` | pick a daemon by its number in `GET /api/avatars` |
| `GET /api/avatars` | the daemons, grouped by type |
