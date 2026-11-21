# Running the playground

## What it needs

- **DAEMONS beside it**: `~/Projects/DAEMONS` and `~/Projects/daemons-eudaimonia`, as DAEMONS' `setup.sh` arranges
  (it links this repository in as `DAEMONS/eudaimonia`). The ROMs are read from DAEMONS' `ROM RELEASE/`, so a release
  must have been built on this machine.
- **Python 3.8 or newer**, nothing to install, for the playground itself.
- **For the COMPANION tab**: daemons-companion beside DAEMONS (linked as `DAEMONS/companion`), `npm install` once in its
  `server/` and its `app/`, and Node 24. Without it the game still plays.

## Start it

```bash
./bindEudaimonia.sh
```

Then open `http://localhost:4740/`, or the tailnet address it prints to play from a phone. Nothing else needs to be
running. The same command starts EUDAIMONIA beside it on port 4741 ([Accounts and sign-in](Accounts-and-sign-in)),
when Node 22.18 or newer is there; without it the playground runs alone.

| | |
|---|---|
| `./bindEudaimonia.sh --build` | DAEMONS' own `engineGba` build instead of the latest release, to try a change before it is released |
| `./bindEudaimonia.sh --port 8000` | another port for the playground |
| `./bindEudaimonia.sh playground` | the playground alone, with any of the options here |
| `./bindEudaimonia.sh --companion URL` | the COMPANION tab's site from somewhere else -- `http://localhost:8081/` is the Expo dev server's, to work on the companion and see each change at once |
| `./bindEudaimonia.sh --no-companion` | no companion of the playground's own |
| `./bindEudaimonia.sh --companion-port 4731` | the first of the four companions' ports |
| `./bindEudaimonia.sh always` | keep both running: a login agent starts them at login and again if they stop, their output in `data/playground.log` (it does not keep the Mac awake) |
| `./bindEudaimonia.sh never` | stop doing that |
| `DAEMONS_ROOT=/path/to/DAEMONS` | DAEMONS somewhere other than beside this repository |
| `COMPANION_ROOT=/path/to/daemons-companion` | the companion somewhere other than `DAEMONS/companion` |

## Who it answers

**Only this machine, a private network and the tailnet.** Anything else is refused before a byte is read. Keep it that
way: the ROMs run Nintendo's engine, and the playground exists to show the game to people on your own network.

## Its files

`data/` is ignored by git and is this machine's alone: the saves the browser posts (`data/saves/`), the companions'
databases (`data/companions/`), the export of the companion's site (`data/companion-site/`), the commit it was made from
(`data/companion-src/`) and its log (`data/companion-site.log`), and each
companion's own log (`data/companions/<build>/server.log`).
