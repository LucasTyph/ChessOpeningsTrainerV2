# Chess Openings Trainer

Learn and keep your opening repertoire with spaced repetition, the way Anki
schedules flashcards. The whole app is one HTML file that runs in your browser,
with no install, no account and no server.

## Getting started

Open it online: <https://lucastyph.github.io/ChessOpeningsTrainerV2/>

Or run it from your own computer:

1. Download [`Chess Openings Trainer.html`](Chess%20Openings%20Trainer.html).
2. Double-click it.

The online version and a downloaded copy keep separate progress. Use the backup
export and restore in Settings to move data between them.

On first launch, add some lines in the **Repertoire** tab (or press
**Try a sample repertoire**), then go to **Train**.

## How training works

Every move *you* play in your repertoire is a card. For each card the app plays
the line out on the board up to your turn, and you answer by making the move.
White and Black cards are mixed in the same session.

- **New moves** are shown with an arrow the first time. You then have to play
  the move correctly 2 times in the same session before it is scheduled for the
  next day.
- **Reviews** come back at growing intervals. A correct answer pushes the move
  further out; a wrong answer brings it back in the same session and restarts
  it at one day.
- **Daily limit**: 10 new moves per day by default. When you are done for the
  day you can ask for a few more.

If you play a different move that is also in your repertoire for that position,
it is not counted as a mistake; the app just asks for the other one.

**One full line per session.** After the last card, the app picks one line from
your repertoire and has you play every one of your moves in it from move 1,
with the opponent's replies played for you. The line stops before the first
move you have not started learning. It is extra practice and does not change
the review schedule. When you are caught up, **Play a full line** on the Train
screen starts one on its own.

The name of the opening you are in (for example "C50 Italian Game") is shown
during training and in the editor.

## Building a repertoire

The **Repertoire** tab keeps a separate move tree for White and for Black.

- **Add moves** by playing them on the board. Play the opponent's replies too,
  so the app knows which positions to quiz you on.
- **Delete move** removes the selected move and everything after it.
- **Make main** promotes a sideline to the main line.
- **Import PGN** from a file or by pasting. Variations and comments are kept,
  several games are merged into one tree, and moves you already have are not
  duplicated.
- **Export PGN** saves the selected colour's tree as a `.pgn` file.
- A **note** can be attached to any move; it is shown after you answer.
- **Progress dots**: each of your own moves carries a dot showing where it
  stands: new (grey ring), learning (orange), young (green ring) or mature
  (solid green, reviewed at intervals of three weeks or more).
- **Gaps** lists opponent moves you have no answer to: moves in your tree that
  you never replied to, and replies from the built-in opening book that are
  missing from your tree. Each book reply shows how many named book lines
  follow it, which is a rough guide to how standard it is, not game
  statistics. Click a gap to jump to the position and add the moves.

Arrow keys step through the tree: left and right move one move, up and down
jump to the start and the end of the line.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| New moves per day | 10 | How many unseen moves are introduced each day |
| Correct answers to learn a move | 2 | Times a new move must be played right before it is scheduled |
| Auto-play speed | Normal | How fast the line is played out before your move |
| Sound effects, volume | On | The right/wrong answer sounds |

## Your data

Repertoires, progress and settings are stored in the browser you open the file
with (`localStorage`). They are not shared between browsers or computers, and
clearing the browser's site data removes them.

Use **Settings → Export backup** to save everything to a `.json` file, and
**Restore…** to load it again, for example when moving to another computer.

## Development

The app is plain JavaScript, bundled with esbuild into a single file.

```bash
npm install
npm test
npm run build
```

`npm run build` writes `Chess Openings Trainer.html`. `npm test` checks the PGN,
scheduling, opening book and gap logic.

The opening book in `src/openings-data.js` is generated and committed. To
refresh it from the lichess list (needs internet):

```bash
node scripts/build-openings.mjs
```

| Path | Contents |
| --- | --- |
| `src/train.js` | Training screen and session flow |
| `src/srs.js` | Card generation, scheduling, full-line picker |
| `src/openings.js`, `src/openings-data.js` | Opening book: names and known continuations |
| `src/gaps.js` | Coverage gap finder |
| `src/repertoire.js` | Repertoire editor |
| `src/pgn.js` | PGN import and export |
| `src/board.js` | Board wrapper around chessground |
| `src/sound.js` | Synthesized sound effects |
| `src/store.js` | Saved state and settings |
| `src/settings.js`, `src/ui.js`, `src/style.css` | Settings screen, UI helpers, styles |
| `build.mjs` | Build script |
| `scripts/build-openings.mjs` | Regenerates the opening book data |

## Credits and license

- [chessground](https://github.com/lichess-org/chessground) (board, GPL-3.0)
  with the cburnett piece set by Colin M.L. Burnett
- [chess.js](https://github.com/jhlywa/chess.js) (move rules, BSD-2-Clause)
- [lichess chess-openings](https://github.com/lichess-org/chess-openings)
  (opening names and lines, CC0)

The built HTML file includes chessground, so it is distributed under the terms
of the GPL-3.0.
