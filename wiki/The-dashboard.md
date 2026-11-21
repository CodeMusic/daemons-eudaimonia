# THE DASHBOARD

**EUDAIMONIA's front door: the work under way, drawn as the daemons doing it.** Anyone who reaches the site sees it
(port 4741, on this machine, a home network or the tailnet). The one thing it changes is a ticket that waits on the
user, when a signed-in admin answers it. Every word of it is a DRAFT (E-1).

## What it shows

- **Each project's progress**: DAEMONS, THE COMPANION and EUDAIMONIA, closed against open, and how many tickets are at
  work.
- **THE LANES**: one tile for each lane (game, story, audio, art, app, hub, esp32, pi-zero, playground, docs, ops), drawn
  with **its daemon**.
  - **At work**: while the lane has a ticket in progress, its daemon sits at a keyboard and types, and the tile names
    the ticket.
  - **Asleep**: when it has none, the daemon dozes, and the tile says how many tickets are waiting for it.
  - **Its modal**: AT WORK, NEXT (its ready tickets in order) and LATELY DONE.
- **WAITING ON YOU**: every ticket that needs the user's decision, or is blocked on them, drawn with the player from the
  game: the grey monkey in the hat. On a phone this panel comes first.
- **THE RELEASES**: the newest five and every one after them.
  - A release opens its notes.
  - A sealed group opens the PDF that holds all of its notes.

## Nothing leaves the page

A lane, a ticket or a release opens in a **modal**. **FULL VIEW ↗** opens the same thing alone in a new tab, filling it.
Those addresses can be kept and shared:

| | |
|---|---|
| `/#ticket=T-465` | one ticket: its words, its fields, its latest notes |
| `/#release=v11.411.1` | one release's notes |
| `/#releases` | every release |
| `/#lane=game` | one lane |

## A lane's daemon

A lane's daemon is the avatar of its **agent account**: an agent named for the lane ([Accounts and sign-in](Accounts-and-sign-in)).

- **A lane with no account yet** is drawn as a question mark.
- **To give a lane its daemon**, an admin opens the lane and chooses **GIVE IT A DAEMON**. The agent account is made, and
  its key is shown once.
- **To change it**, choose **ANOTHER DAEMON FOR IT**.
- **ACCOUNTS** does the same.

## Where it reads from

**For now, the tickets come from Redmine**, read-only, a minute at a time. Several pages asking at once share one read,
and if Redmine can't be reached the last reading stays up, marked with its age.

- **The key**: the site's server reads Redmine with the playground lane's key, from `~/.redmine.env` (`REDMINE_URL`,
  `REDMINE_KEY_PLAYGROUND`; or another file named by `$REDMINE_ENV`). The key is never logged and never sent to a page.
- **What a page sees** is what the TODO mirrors already publish: each ticket's id, title, status, lane, fields and notes.
  A note's author is shown as its lane, *a session*, or *a person*, and never by name.
- **The releases** come from DAEMONS' `ROM RELEASE/`, read when asked for. Only their notes are read: never a ROM.

**PRAXIS takes Redmine's place.** The design has the dashboard read from PRAXIS, with Redmine reaching it through the
bridge's read-only mirror (the companion's C-434). When that is built, `src/redmine.ts` is the one file it replaces.

## Answering what waits on you

**A ticket that waits on you is answered in its modal.** That is one that needs your decision, or is blocked on you.
Sign in as an admin, and past the first password, and YOUR ANSWER appears under the ticket:

- **Its choices**, as buttons, when the ticket gives some; and **your own words**, as well or instead.
- **ANSWER** adds it to the ticket as a note, in the project's way of quoting you:
  `**The user's answer** (*the user, 2026-11-21, on THE DASHBOARD*): **the choice** -- your words`.
  It also moves the ticket back to **Ready**, so its lane picks it up again.
- **It still waits on me** leaves only the note, and the ticket keeps waiting.

Nobody else can answer, and nothing else on the page writes to Redmine (`src/answers.ts`).

**Whose name a note is under.** Until your own Redmine key is on the server, the note is written as *Claude sessions*, and
its words say it is yours (the user, 2026-11-21, by multiple choice). Once you add your Redmine account's API key to
`~/.redmine.env` as `REDMINE_KEY_USER=…`, every answer after that is under your own account. Restart the site after
adding it.

**How a lane gives you choices.** From DAEMONS, a lane puts the question with its choices:

```sh
python3 tools/tickets.py ask T-581 --lane game --question "Which way?" --choice "One way" --choice "The other"
```

The ticket moves to *Needs decision* and gets a note with a `Choices:` line and a list under it, which the dashboard draws
as buttons, at most eight of them. A ticket written by hand can do the same.

## For whoever runs it

| | |
|---|---|
| `GET /api/board` | the projects, the lanes (each with its daemon) and what waits on the user |
| `GET /api/ticket/<id>` | one ticket, by its id |
| `GET /api/releases` | every release, newest first |
| `GET /api/release/<name>` | one release's notes |
| `GET /release/<group>/notes.pdf` | a sealed group's notes |
| `GET /art/player.png` | the player's picture, from the companion's art |
| `POST /api/ticket/<id>/answer {text, choice?, keep?}` | an admin's answer to a ticket that waits on the user |
