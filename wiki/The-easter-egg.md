# The easter egg

**Your cart becomes a DAEMONS cart.** A dim egg sits somewhere on EUDAIMONIA's front page. Open it and it asks a riddle;
its answer is the password, taken in any case. Every word of it is a DRAFT.

## Which cart do you own?

FIRERED, LEAFGREEN or BOTH, drawn as carts. Choose: the others leave, and the chosen turn into **CONTENT** (FireRed's
edition) and **CONTEXT** (LeafGreen's). A cookie keeps the answer in that browser, so the next visit opens on your carts;
*Forget them, and start again* clears it. The password is asked only before the first choice, and again to play the
release's own ROM once the browser's pass has run out.

## Playing a cart

A cart plays in **the playground's player**, framed over the page: the same page as at port 4740, with its saves kept
and downloaded, its companion and what's new. CLOSE keeps the save first. It is made one of two ways:

- **YOUR OWN CART.** Choose your FireRed's or LeafGreen's file, 1.0 or Rev 1, as dumped from the cart. Your browser
  checks it, fetches the latest release's BPS patch and makes it into DAEMONS, checking the result: **nothing of your
  file is sent anywhere**, and only the patch, which every release publishes, comes from the server. A file that is
  already the release's ROM plays as it is.
- **THE RELEASE'S OWN.** Tick *These are backups of carts I own*, give the password if this browser holds no pass, and
  the release's own ROM is sent from this machine.

## What it keeps, and where it comes from

| | |
|---|---|
| the password | a scrypt hash of it in small letters, in `data/eudaimonia/accounts.json`; the admin changes it in ACCOUNTS |
| a browser's pass | the cookie `eudaimonia-egg`, HttpOnly, thirty days; kept on the server only as a SHA-256 hash |
| your carts | the cookie `eudaimonia-carts`, in your browser alone |
| the release, its ROMs and patches | DAEMONS' `ROM RELEASE/`, read when asked for: the newest release with both editions |

The site answers this machine, a home network and the tailnet only, like the playground.

## For whoever runs it

| | |
|---|---|
| `GET /api/egg/carts` | the release, the two carts and the patches that make them, whether this browser holds a pass, the player's port |
| `POST /api/egg/open {password}` | the door: a pass, as a cookie |
| `GET /egg/patch/<release>/<file>.bps` | a release's patch |
| `POST /api/egg/rom {edition, agreed: true}` | the release's ROM, with a pass |

`$PLAYGROUND_PORT` names the player's port (4740; `./bindEudaimonia.sh --port N` passes its own), `$DAEMONS_RELEASES`
another `ROM RELEASE/`.
