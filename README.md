# daemons-eudaimonia

**EUDAIMONIA is to be built here**: the site where [daemons-companion](https://github.com/CodeMusic/daemons-companion)'s
PRAXIS (the doing) and ARETE (the points) are used together, a dashboard of the work under way at its front door.
Its plan is section 10 of the companion's
[docs/PROJECTS.md](https://github.com/CodeMusic/daemons-companion/blob/main/docs/PROJECTS.md). The repository was
the DAEMONS playground until 2026-11-20, and it still serves that beside the site (below).

## EUDAIMONIA, so far

**Its first pieces answer on port 4741**: **THE DASHBOARD**, the work under way drawn as the daemons doing it, and
**SIGN IN** beside it, with the accounts behind it. Every word on it is a DRAFT.

- **THE DASHBOARD** (E-1, for anyone who reaches the site). Each project's progress; **THE
  LANES**, each drawn with its daemon at a keyboard while it has a ticket in progress and asleep when it has none, with
  what it is at, what is next and what it closed lately; **WAITING ON YOU**, drawn with the player, the monkey, for every
  ticket that needs the user's decision; and **THE RELEASES**, each opening its notes. A lane, a ticket or a release
  opens in a modal, and FULL VIEW opens it alone in a new tab (`/#ticket=T-465`, `/#release=v11.411.1`, `/#lane=game`).
  For now it reads the tickets from Redmine, read-only and a minute at a time, with the playground lane's key in
  `~/.redmine.env`; PRAXIS's bridge (the companion's C-434) is to take its place. A lane's daemon is its agent account's
  avatar: an admin gives one from the lane's modal. **A signed-in admin answers a ticket that waits on the user from
  its modal**: its choices as buttons (a lane gives them with DAEMONS' `tools/tickets.py ask`), the user's own words,
  a note in the project's way of quoting the user, and the ticket back to Ready for its lane. That is the site's only
  write to Redmine. It uses the user's own key, `REDMINE_KEY_USER` in `~/.redmine.env`, once it is added there, and
  the sessions' key until then (`src/redmine.ts`, `src/answers.ts`, `src/releases.ts`, `web/dashboard.js`).

- **The first sign-in is `admin` / `admin`, and it is changed at once.** Until it is, that password is taken only from
  this machine, a home network or the tailnet, with no proxy between, and the session it opens can do nothing but
  choose a new one.
- **The admin makes the other accounts**, in ACCOUNTS: **a person** gets a one-time password, changed at their first
  sign-in; **an agent** (a lane, a model at work) never has a password but a key, sent as `Authorization: Bearer <key>`,
  and is never an admin. Either is shown once. The admin can make a new one, close an account and open it again, and
  make another person an admin; there is always one.
- **Every account picks a daemon** in YOUR ACCOUNT, from the daemons grouped by type, each group in its type's colour.
  Its sprite is the account's picture, and is to be its lane's on THE DASHBOARD. The daemons and their sprites are read
  from DAEMONS and the companion beside this repository, never copied here.
- **THE EASTER EGG** is hidden on the front page, behind a riddle and a password the admin keeps (below).

It keeps its accounts in `data/eudaimonia/accounts.json` (this machine's, mode 0600): passwords as scrypt hashes,
sessions and keys as SHA-256 hashes of random bytes, so nothing there can be read back. A browser's change must come
from a page of this site, as JSON; a sign-in is refused for a quarter of an hour after eight wrong passwords from one
address.

### THE EASTER EGG: your cart becomes a DAEMONS cart

A dim egg on the front page asks a riddle; its answer, in any case, is the password. Then: **which cart do you own?** FIRERED, LEAFGREEN or both,
drawn as carts. The others leave, the chosen turn into **CONTENT** and **CONTEXT**, and a cookie remembers them, so the
next visit opens on your carts (with a line to forget them and start again). A cart plays in **the playground's own
player**, framed over the page: its saves, its companion and what's new, as at port 4740. It is made one of two ways:

| | how | what is sent |
|---|---|---|
| **YOUR OWN CART** | your FireRed or LeafGreen file (1.0 or Rev 1, as dumped from the cart), patched in your browser by the latest release's BPS patch, and checked | only the patch, which every release publishes anyway |
| **THE RELEASE'S OWN** | the release's ROM, with the password and a tick that these are backups of carts you own | the ROM, from this machine, to its own networks |

The password is kept only as a hash, folded to small letters so it is taken in any case; a browser that gives it holds
a pass (a cookie) for thirty days. Its value comes from `$EUDAIMONIA_EGG` or the DAEMONS author's private notes, read
at every start until the admin sets one, and never from a repository; **the admin changes it in ACCOUNTS**, and a new
one closes every pass the old one gave. The patches and ROMs
are read from DAEMONS' `ROM RELEASE/` when they are asked for, never kept here (`src/egg.ts`, `web/egg.js`,
`web/bps.js`).

It runs on **Node 22.18 or newer**, which runs its TypeScript (`src/`) as it is. Its one package is **PRAXIS's engine**,
[daemons-praxis](https://github.com/CodeMusic/daemons-praxis), pinned by tag in `package.json`: `./bindEudaimonia.sh`
fetches it (`npm ci`) the first time and whenever the pin moves. The engine is TypeScript too, and Node will not strip
types under `node_modules`, so `src/praxis.ts` loads it through a small hook of Node's own. `npm test` runs the tests;
`npm install` once fetches the type checker, for `npm run typecheck`.

### The tickets, in PRAXIS (E-9)

THE DASHBOARD draws its tickets from **PRAXIS**, not from Redmine. Getting off Redmine takes three steps, the last one
the user's call: **the mirror** (E-9, this), **tickets here** (E-10: the list, the board, the roadmap, a ticket's page
and editing), then **the cut-over** (E-11: `tools/tickets.py` talks to PRAXIS, and Redmine stays as a read-only archive).

- **The always-on replica** runs on roverbyteseer beside Redmine: `./bindEudaimonia.sh replica` (port 4742;
  `replica always` keeps it running as a login agent). Every two minutes it mirrors Redmine's three projects into
  PRAXIS (`src/mirror.ts`): each project a space made from the WORK form (`src/work.ts`), each ticket an item that keeps
  its id (T-581), each journal's words a note with its own time and author, each relation a link. Closing a ticket
  pays its lane the kind's ARETE once, in PRAXIS's ledger (DRAFT numbers: a Job 5, a Bug 3). It only reads Redmine and
  asks only for what changed since the last run.
- **This site keeps a replica of its own** (`data/eudaimonia/praxis.sqlite`) and takes what it lacks from the always-on
  one every minute (`src/replica.ts`; `$PRAXIS_REPLICA`, default `http://roverbyteseer:4742`, `off` for none). Away from
  home, the dashboard shows the tickets as they stood at the last pull, marked stale after five minutes. Until the first
  pull has brought all three spaces, it reads Redmine as before.
- Three of the oldest tickets (`T-183b`, `T-184a`, `T-185a`) have a letter in their number, which a handle cannot
  hold, so they are not mirrored; the cut-over has to decide what they become.

### THE SPACES: the tickets here (E-10)

THE SPACES, on the front page, lists every space PRAXIS holds. Each opens as a **LIST**, a **BOARD** (a column per
state) or a **ROADMAP** (at work, next lane by lane in their order, waiting, lately done), in a modal with FULL VIEW for
a new tab (`/#space=C&view=board`). A ticket opens as its own page: every field and note, its links and its history.

- **The mirrored spaces** (DAEMONS `T-`, THE COMPANION `C-`, EUDAIMONIA `E-`) are read here by anyone and changed in
  Redmine until the cut-over (E-11).
- **A space of your own**, made here when signed in (a name and a prefix, `HOME-1`), takes its tickets here: a ticket
  made with its kind, lane, priority and order; its state, lane, priority and order changed the moment they are picked;
  its title and words by EDIT; a note at a time. Every change is an event written as the account that made it, a person
  or an agent (by its key: `Authorization: Bearer ...`), and goes to the always-on replica within a second. That
  replica refuses anything in a mirrored space. A space of your own is shown only to the signed in, unless made public.

### WORKING MEMORY: what each lane has in mind (E-12)

Each lane's daemon keeps what it has in mind now -- what a session's handoff holds: in flight, waiting on the user,
next -- in a space of PRAXIS's WORKING MEMORY form (C-469): about seven things, each about one thing and rewritten when
held again, the least rehearsed let go when a new one comes. A session writes it as its lane with DAEMONS'
`tools/tickets.py mind --lane L --hold "..." --about in-flight` (`--let-go` to clear), and EUDAIMONIA asks Redmine which
lane its key is (`POST /api/mind/<lane>`, the key in `X-Redmine-Key`). It shows as **IN MIND** on the lane's page and its
tile on THE DASHBOARD, **to someone signed in only**: a handoff carries private material, so the space's reach is home
and is never made public. It goes to the always-on replica with the spaces of your own.

## The DAEMONS playground

**An all-in-one harness to demo and beta test [DAEMONS](https://github.com/CodeMusic/DAEMONS)**, the whole game and
everything around it, from one URL. New to the game itself? **[MICRO-START](https://github.com/CodeMusic/DAEMONS/blob/main/docs/DAEMONS-microstart.pdf)** (PDF) is five pages,
**[QUICK-START](https://github.com/CodeMusic/DAEMONS/blob/main/docs/DAEMONS-quickstart.pdf)** (PDF) 25 in large type, and **[the player's manual](https://github.com/CodeMusic/DAEMONS/blob/main/docs/DAEMONS-manual.pdf)** (PDF) has every way to play, the world, the daemons, the
companion and a glossary. **Why the name? [THE OLD WORD](https://github.com/CodeMusic/DAEMONS/blob/main/docs/DAEMONS-etymology.pdf)** (PDF) tells how the Greek *daimon* branched, and why it is said *DAY-mons*.
**From CALLOW SCHOOL: [PRINCIPLES OF MIND](https://github.com/CodeMusic/DAEMONS/blob/main/docs/DAEMONS-textbook.pdf)** (82 pages), its TEXTBOOK written out as a university textbook -- seven floors, Language to Error, each taught from the research.

Open the page, choose **CONTENT** or **CONTEXT** (and the **DEBUG** build, if you want its kit), start a new game or
continue from a `.sav`, and play it right there in the browser: on a Mac with the keyboard, on a phone with the buttons
on the screen. Beside the game:

- **COMPANION**: [daemons-companion](https://github.com/CodeMusic/daemons-companion)'s site in a tab, the daemon you
  carry, its care, the routines and the CASINO -- on **a companion of the playground's own**, fed the game you are
  playing. **SEND** a daemon in the game, open the tab, and it is there. The game pauses while you look.
- **WHAT'S NEW**: each release's notes (the last twelve), newest first, every engine and design change linked to its commit. If a newer
  release lands while you play, the page says so.
- **HELP**: how to play, how to use the companion (SEND, SYNC, care, CALL HOME), and where else a daemon can live --
  the companion's iPhone app and the LilyGO and M5Stack boards. It is on the start page too.
- **Download save**: the game's save as a `.sav` at any moment, for mGBA, Delta or a cart. The page also keeps the
  last one in your browser and offers it the next time you come back.

It always serves the **newest release**: the ROMs are read from DAEMONS' `ROM RELEASE/` each time a game starts.

It is the browser's side of what [the companion's one app](https://github.com/CodeMusic/daemons-companion/wiki/The-one-app)
does on an iPhone or iPad -- the game and the companion together -- for anyone on your network, with nothing to install.

**Every page of how it works: [this repository's wiki](https://github.com/CodeMusic/daemons-eudaimonia/wiki).** The
game itself, its editions and its releases: [the DAEMONS wiki](https://github.com/CodeMusic/DAEMONS/wiki). To play
DAEMONS on your own hardware instead, each DAEMONS release publishes patches for your own cartridge's game
([Releases](https://github.com/CodeMusic/DAEMONS/wiki/Releases)).

## Running it

DAEMONS sits beside this repository (`~/Projects/DAEMONS` and `~/Projects/daemons-eudaimonia`), as its
`setup.sh` arranges, and links this one in as `DAEMONS/eudaimonia`.

```bash
./bindEudaimonia.sh
```

Then open `http://localhost:4740/` for the playground and `http://localhost:4741/` for EUDAIMONIA, or the tailnet
addresses they print, to reach them from a phone. If EUDAIMONIA stops, it starts again by itself ten seconds later;
if the playground stops, both do. Nothing else needs to be
running: the COMPANION tab's site is the playground's own too (see [The companion's site](#the-companions-site)). The
companion needs daemons-companion beside DAEMONS (DAEMONS' `setup.sh` links it as `DAEMONS/companion`), installed once
(`npm install` in its `server/` and its `app/`), and Node 24.

| | |
|---|---|
| `./bindEudaimonia.sh --build` | DAEMONS' own `engineGba` build instead of the latest release, to try a change before it is released |
| `./bindEudaimonia.sh --port 8000` | another port for the playground |
| `./bindEudaimonia.sh site` | EUDAIMONIA alone (`--port N` for another than 4741, `--data DIR` for another accounts folder) |
| `./bindEudaimonia.sh playground` | the playground alone, with any of the options here |
| `./bindEudaimonia.sh --companion URL` | the COMPANION tab's site, instead of the playground's own export of it: `http://localhost:8081/` is the Expo dev server's (`./companion/bindCompanion.sh app`), to work on the companion and see it at once |
| `./bindEudaimonia.sh --no-companion` | no companion of the playground's own: the tab shows the site on its own server |
| `./bindEudaimonia.sh --companion-port 4731` | the first of the four companions' ports |
| `./bindEudaimonia.sh always` | keep both running: a login agent starts them at login and again if they stop, their output in `data/playground.log` (it does not keep the Mac awake) |
| `./bindEudaimonia.sh never` | stop doing that |
| `DAEMONS_ROOT=/path/to/DAEMONS` | DAEMONS somewhere other than beside this repository |
| `COMPANION_ROOT=/path/to/daemons-companion` | the companion somewhere other than `DAEMONS/companion` |

Python 3.8 or newer, nothing to install.

## What is not here, and why

**No ROM, and nothing of Nintendo's.** DAEMONS is built on pret's disassembly of a Nintendo game, so its ROMs are never
distributed. This repository holds only the page and its small server (and `data/`, ignored: the saves, the
companions' databases and the export of the companion's site, this machine's alone); the ROMs are read from the DAEMONS checkout
beside it, on the machine that built them. **The server answers only that machine, a private network and the
tailnet**, and refuses anything else before a byte is read. Keep it that way: the playground is for demos and beta
testing among the people on your own network, never a public site.

**No emulator either.** The game runs on [EmulatorJS](https://emulatorjs.org) (GPL-3.0) and its mGBA core, loaded from
EmulatorJS's own CDN, version 4.2.3, when a game starts. EmulatorJS keeps a copy of a ROM it has played in the browser and plays it again
whenever the size matches, and every DAEMONS ROM is the same size, so until 2026-11-21 a browser went on playing the
first release it ever played here (E-5). The page now names the release in the ROM's address, which EmulatorJS keys its
copy by, and forgets every other copy of that build before a game starts: the newest release is always the one played,
and a save still carries from one release to the next.

## How the save is kept

EmulatorJS keeps a game's save in the browser while it runs but lets it go when the page is left, so the page keeps its
own copy. It checks the game's save every five seconds and whenever the page is hidden or closed, and stores it in the
browser's IndexedDB under the build's name whenever it has changed. A `.sav` you choose at the start replaces it. With
none chosen, the kept one is offered (continue it, download it, or start a new game) rather than silently continued or
lost. A saved game is 128 KB; mGBA's 131,088-byte files, with its clock after the flash, load as they are.

## The companion beside the game

The COMPANION tab never shows your own companion. The playground runs **one of its own for each build** -- CONTENT on
port 4731, CONTEXT 4732, their DEBUG builds 4733 and 4734 -- each daemons-companion's own server, started the first
time a game of that build opens the tab and stopped with the playground. Each keeps its database in `data/companions/`
and reads the save in `data/saves/`, which is the browser's: the page posts the game's save there whenever it changes.
Nothing here touches the companion on port 4730, its database or a save of yours.

**Sending a daemon** works as it does with a cart and the app. In the game, a daemon's menu offers SEND (a DEBUG game's
kit has the companion linked already; a normal one needs a first SYNC). The game saves. Open COMPANION: the companion
SYNCs that save, takes the daemon and writes it AWAY, and the save it wrote goes back into the game, which starts again
from it (the game is closed while the app edits its save). Back on GAME, choose CONTINUE: the daemon is washed out in
the party, and it is on the companion's TODAY and DAEMON pages, to feed, train and take on its routines. Bringing it
home is the same, the other way. A SYNC pressed in the companion's own site is taken back into the game too.

**From a phone** it works the same way over the tailnet. The companions listen only on the Mac; the companion's site
reaches the one for your build through the playground's server, at `/companion/<build>/` (it is told where by
`?server=`). So a phone needs no pairing, and what only the Mac may do (pairing a phone, opening the network, the file
picker, the relay, Home Assistant, the save's path) is refused there.

**A new game** puts the old save aside (`data/saves/*.before-new-game.sav`). A companion already married to another
game says so and offers to start fresh; the old one is kept aside as `data/companions/<build>.before`.

**One companion per build, for everyone.** Two people playing the same build on one playground at once share its save
and its companion, and each one's save replaces the other's. For a beta test with several people at once, give each a
different build, or a playground of their own.

## The companion's site

The COMPANION tab shows daemons-companion's own site, **exported by the playground and served by it**: as it starts, it
takes the companion's `app/`, `server/src` and `server/data` as committed at its HEAD (`git archive`, into
`data/companion-src/`, with the app's `node_modules` linked from `DAEMONS/companion/app`), runs
`npx expo export --platform web` there (with Node 24) into `data/companion-site/`, and the tab opens it at
`/companion-site/` on the playground's own address, told by `?server=` to use the playground's companion. So the tab
needs no Expo dev server, and a phone on the tailnet loads one minified bundle (about 2 MB, once: its name changes with
what is in it) instead of a development build.

It is exported again only when the companion's HEAD has moved since the last export: a new commit. **What is not
committed never reaches it.** The companion's working tree is often mid-change -- on 2026-11-11 a screen imported a file
not yet written, and an export made from the working tree failed -- so testers see only what has been committed, and a
change half-made cannot break the export. The playground looks as it starts and, at most every 30 seconds, as pages ask
after it; the export runs in the background (a few seconds once Metro's cache is warm, about a minute the first time)
and the one before is served until it is done. The commit it was made from is in `data/companion-site.json`, the
export's output in `data/companion-site.log`. An export that fails keeps the one before, and is not tried again until
the companion's HEAD moves.

The export names its files from the root (`/_expo/…`, `/assets/…`: the app sets no `baseUrl`), so the playground serves
those two folders from it as well; nothing of the playground's own lives there.

**To work on the companion's site** and see each change at once, uncommitted ones too, run the Expo dev server
(`./companion/bindCompanion.sh app` from DAEMONS) and start the playground with `--companion http://localhost:8081/`.
If the playground cannot export the site at all (no `npm install` in `app/`, no Node 24) and has never exported it, the
tab falls back to that dev server on the page's own host, port 8081, and says why when nothing answers there.

## On a phone

An iPhone (Safari and Chrome alike) starts a page's sound only inside a tap, and the game starts a few seconds after the
tap on PLAY, once the emulator and the ROM have arrived. Its sound then waits, and the emulator waits on its sound, so
the screen stays blank: the page puts **TAP TO PLAY** over the game, and that tap starts it. The same comes back if the
phone interrupts the sound later (a call, the lock screen). On a computer the sound runs from the PLAY press, and it
never shows.

**What goes wrong on a tester's device is in the playground's log** beside its address -- the page's errors, what
EmulatorJS warns of, and a line as each game starts (`N frames in 5 s, sound running`) -- since a phone has no console
to read.

## Keys

Arrows move, **X** is A, **Z** is B (as in mGBA: EmulatorJS's own default is the other way round), **Enter** START,
**V** SELECT, **Q** and **E** L and R. Change them with the controller button under the game; a mapping you chose is
kept. On a phone, the buttons on the screen, laid out as on a GBA.
