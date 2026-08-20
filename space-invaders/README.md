# Space Invaders

A single-file, mobile-first Space Invaders clone. No build step, no dependencies,
no network requests — open `index.html` and play.

## Play

* **Touch:** drag anywhere on the playfield to move, tap to fire, or use the
  on-screen LEFT / RIGHT / FIRE buttons (both work at the same time).
  Drag sensitivity scales with the screen, so half a screen-width always sweeps
  the cannon across the whole field: a thumb planted anywhere in the middle half
  of the screen can reach either wall without lifting.
* **Keyboard:** arrows or `A`/`D` to move, `Space` to fire, `P` or `Esc` to
  pause, `M` to mute, `F` for full screen.

## What's in it

* Arcade-accurate 224x256 playfield, 5x11 fleet of squids / crabs / octopuses,
  two-frame sprite animation, and the classic marching bass line that speeds up
  as the fleet thins out.
* Four destructible bunkers with per-pixel erosion from both directions, plus
  invaders that grind through them on the way down.
* Mystery ship using the original shot-count score table (50-300 points).
* One player shot on screen at a time, three bomb types, extra life at 1,500.
* Waves that start lower and march faster, high score in `localStorage`,
  pause on tab blur, haptics, CRT scanline overlay, and a share button.
* All sound is synthesised with the Web Audio API — no audio files.

## Tests

Automated Playwright tests cover layout across five device profiles plus the
game rules themselves:

```
npm install playwright
node test/smoke.mjs      # layout, controls, no overlap, no page scroll
node test/gameplay.mjs   # fleet behaviour, scoring, shields, lives, game over
node test/touch.mjs      # real multi-touch regressions (CDP touch events)
node test/balance.mjs 8  # difficulty measurement with a scripted player
```

Screenshots land in `.shots/`. `balance.mjs` reports fleet descent times, score
distribution, wave-1 clear rate and how much of the time the barrel sits idle;
it is a measurement tool rather than a pass/fail suite.

`window.__SI` exposes a small debug handle used by the tests
(`__SI.cheat.noBombs`, `__SI.cheat.invincible`, `__SI.killAll()`); it is inert
during normal play.
