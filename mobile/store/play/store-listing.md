# Google Play store listing: Backgammon

Package: `com.skeptrune.backgammon`
Privacy policy URL: https://bg.skeptrune.com/privacy

## App name

Backgammon

## Short description (80 characters max)

Play backgammon matches against the GNU Backgammon neural-net engine.

(69 characters)

## Full description (4000 characters max)

Play full backgammon matches against GNU Backgammon, the free neural-network engine that serious players use to study the game.

HOW IT PLAYS
- 7-point matches against GNU Backgammon, running at 2-ply strength.
- Tap a highlighted checker to move it. Legal moves are worked out for you, so you can only make legal plays.
- Undo your move step by step before you confirm it.
- With two different dice, choose which die to play first.
- Pip counts for you and your opponent are always shown.
- Full match rules from the engine: doubling cube, Crawford rule, gammons and backgammons.
- Double when it is your turn to roll, and take or pass when the engine doubles you.
- The engine may offer to resign a lost game; accept or play on.
- Built for landscape, on a wood and felt board.

PRIVATE BY DESIGN
- No account and no sign-in.
- No ads, no analytics, no tracking.
- The engine runs on your phone. Your matches are saved only on your device.
- An internet connection is needed to load the engine when the app starts.

GNU Backgammon is free software licensed under the GPL-3.0 (https://www.gnu.org/software/gnubg/). This app runs a WebAssembly build of it from the gnubg-web project by Theodore Hwa.

Questions or feedback: me@skeptrune.com

## Category

Games > Board

## Tags to consider

Board, Backgammon, Single player, Offline-style (do not pick "Offline": the app needs a connection at launch to load the engine)

## Contact details

- Email: me@skeptrune.com
- Website: https://bg.skeptrune.com

## Graphics

| File | Size | Use |
| --- | --- | --- |
| icon-512.png | 512 x 512 | App icon |
| feature-graphic.png | 1024 x 500 | Feature graphic |
| screenshot-1-midgame-move.png | 1920 x 1080 | Mid-game, move entered, Undo and Confirm |
| screenshot-2-legal-moves.png | 1920 x 1080 | Dice rolled, legal moves highlighted |
| screenshot-3-gnubg-doubles.png | 1920 x 1080 | GNU Backgammon doubles: Take or Pass |
| screenshot-4-double-or-roll.png | 1920 x 1080 | Your turn: Double or Roll |
| screenshot-5-bearoff-resignation.png | 1920 x 1080 | Bear-off, engine offers to resign |

Screenshots are of the app's own React Native UI (App.tsx, src/ui/Board.tsx) rendered through react-native-web in headless Chromium at 960x540 with deviceScaleFactor 2, playing a real match against the engine. Upload them under "Phone screenshots".

## Notes before publishing

- The listing describes only what the Android app does. The web app at bg.skeptrune.com has more (match analysis, Trends, Training, pip-count lessons, sign-in and sync). None of that exists in the Android app, so it is not claimed here.
- The Android app saves match records on the device (src/game/store.ts) but has no screen to view them yet, so match history is not advertised.
