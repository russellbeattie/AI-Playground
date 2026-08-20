import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.join(__dirname, '..', 'index.html');
const SHOTS = path.join(__dirname, '..', '.shots');

const fails = [];
const log = (...a) => console.log(...a);
function check(cond, msg) {
  if (cond) log('  PASS  ' + msg);
  else { log('  FAIL  ' + msg); fails.push(msg); }
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const S = (fn, arg) => page.evaluate(fn, arg);

await page.goto(FILE);
await page.waitForFunction(() => !!window.__SI);
await S(() => { try { localStorage.clear(); } catch (e) { } window.__SI.game.hi = 0; });

log('\n=== fleet movement ===');
await S(() => window.__SI.start());
await page.waitForFunction(() => window.__SI.game.state === 'play');
const trail = await S(async () => {
  const g = window.__SI.game, out = [];
  for (let i = 0; i < 170; i++) {
    out.push({ x: g.fleetX, y: g.fleetY, dir: g.dir, f: g.frame });
    await new Promise(r => setTimeout(r, 100));
  }
  return out;
});
const movedX = new Set(trail.map(t => t.x)).size;
const droppedY = new Set(trail.map(t => t.y)).size;
const flipped = new Set(trail.map(t => t.dir)).size;
const animated = new Set(trail.map(t => t.f)).size;
check(movedX > 3, `fleet marches sideways (${movedX} distinct x positions in 17s)`);
check(flipped === 2, 'fleet reverses direction at the edge');
check(droppedY > 1, `fleet drops down a row when it turns (${droppedY - 1} drops in 17s)`);
check(animated === 2, 'invader sprites animate between two frames');

log('\n=== invaders stay inside the play field ===');
const bounds = await S(() => {
  const g = window.__SI.game, T = [{ w: 8, o: 4 }, { w: 11, o: 2 }, { w: 12, o: 2 }];
  let min = 999, max = -999;
  for (const a of g.aliens) {
    if (!a.alive) continue;
    const x = g.fleetX + a.col * 16 + T[a.type].o;
    min = Math.min(min, x); max = Math.max(max, x + T[a.type].w);
  }
  return { min, max };
});
check(bounds.min >= 0 && bounds.max <= 224, `fleet within 0..224 (${bounds.min.toFixed(1)}..${bounds.max.toFixed(1)})`);

log('\n=== shooting and scoring ===');
await S(() => { window.__SI.cheat.noBombs = true; window.__SI.cheat.invincible = true; window.__SI.game.bombs.length = 0; });
const kill = await S(async () => {
  const g = window.__SI.game;
  // aim at the bottom-most alien of a column, then fire until it dies
  const target = g.aliens.filter(a => a.alive && a.row === 4)[3];
  const before = { score: g.score, alive: g.alive };
  for (let i = 0; i < 80 && g.aliens.filter(a => a.alive).length === before.alive; i++) {
    const T = [{ w: 8, o: 4 }, { w: 11, o: 2 }, { w: 12, o: 2 }][target.type];
    g.player.x = g.fleetX + target.col * 16 + T.o + T.w / 2 - 6;
    window.__SI.fire();
    await new Promise(r => setTimeout(r, 120));
  }
  return { before, score: g.score, alive: g.alive };
});
check(kill.alive === kill.before.alive - 1, 'a shot destroys exactly one invader');
check(kill.score === 10, `bottom-row invader scores 10 (got ${kill.score})`);

const kill2 = await S(async () => {
  const g = window.__SI.game;
  const target = g.aliens.filter(a => a.alive && a.row === 0)[5];
  // clear the columns below it first
  for (const a of g.aliens) if (a.alive && a.col === target.col && a.row > 0) { a.alive = false; g.alive--; }
  const s0 = g.score;
  for (let i = 0; i < 80 && target.alive; i++) {
    g.player.x = g.fleetX + target.col * 16 + 4 + 4 - 6;
    window.__SI.fire();
    await new Promise(r => setTimeout(r, 120));
  }
  return { pts: g.score - s0, dead: !target.alive };
});
check(kill2.dead && kill2.pts === 30, `top-row invader scores 30 (got ${kill2.pts})`);

log('\n=== one shot on screen at a time ===');
const oneShot = await S(() => {
  const g = window.__SI.game;
  g.bullet = null;
  window.__SI.fire();
  const a = !!g.bullet;
  window.__SI.fire();
  window.__SI.fire();
  return a && !!g.bullet;
});
check(oneShot, 'only one player shot can be in flight');

log('\n=== shields ===');
await S(() => { window.__SI.start(); window.__SI.cheat.noBombs = true; window.__SI.cheat.invincible = true; });
await page.waitForFunction(() => window.__SI.game.state === 'play', null, { timeout: 8000 });
const shield = await S(async () => {
  const g = window.__SI.game;
  const s = g.shields[1];
  const count = () => s.grid.reduce((n, v) => n + v, 0);
  const full = count();
  // put a bomb right above the shield and let it land
  g.bombs.push({ x: s.x + 10, y: s.y - 12, w: 3, h: 7, kind: 'roll', frame: 0, ft: 0, vy: 80 });
  await new Promise(r => setTimeout(r, 600));
  const afterBomb = count();
  // and shoot it from below
  g.player.x = s.x + 4;
  g.bullet = { x: s.x + 10, y: s.y + s.h + 2, w: 1, h: 4, vy: -270 };
  await new Promise(r => setTimeout(r, 400));
  const afterShot = count();
  return { full, afterBomb, afterShot, w: s.w, h: s.h };
});
check(shield.full > 250, `shield starts solid (${shield.full} px)`);
check(shield.afterBomb < shield.full, `invader bomb erodes the shield (-${shield.full - shield.afterBomb} px)`);
check(shield.afterShot < shield.afterBomb, `player shot erodes the shield (-${shield.afterBomb - shield.afterShot} px)`);

log('\n=== mystery ship ===');
await S(() => { window.__SI.cheat.noBombs = true; window.__SI.game.bombs.length = 0; });
const ufo = await S(async () => {
  const g = window.__SI.game;
  g.shotCount = 8; // table entry -> 300
  g.ufoTimer = 0.01;
  for (let i = 0; i < 40 && !g.ufo; i++) await new Promise(r => setTimeout(r, 50));
  if (!g.ufo) return { spawned: false };
  const s0 = g.score;
  const before = { x: g.ufo.x };
  await new Promise(r => setTimeout(r, 300));
  const moved = g.ufo.x !== before.x;
  g.bullet = { x: g.ufo.x + 8, y: g.ufo.y + 10, w: 1, h: 4, vy: -270 };
  await new Promise(r => setTimeout(r, 200));
  return { spawned: true, moved, gained: g.score - s0, dead: !g.ufo || !g.ufo.alive };
});
check(ufo.spawned, 'mystery ship appears');
check(ufo.moved, 'mystery ship flies across the top');
check(ufo.dead && ufo.gained === 300, `mystery ship uses the arcade score table (got ${ufo.gained})`);

log('\n=== wave clear + progression ===');
await S(() => { const g = window.__SI.game; g.lives = 3; g.bombs.length = 0; g.shields[0].grid.fill(0); g.shields[0].dirty = true; });
await S(() => window.__SI.killAll());
await page.waitForFunction(() => window.__SI.game.state === 'cleared', null, { timeout: 3000 });
await page.screenshot({ path: `${SHOTS}/gp-cleared.png` });
await page.waitForFunction(() => window.__SI.game.level === 2, null, { timeout: 6000 });
const lvl2 = await S(() => {
  const g = window.__SI.game;
  return {
    level: g.level, alive: g.alive, fleetY: g.fleetY,
    shieldPx: g.shields[0].grid.reduce((n, v) => n + v, 0),
    lives: g.lives,
  };
});
check(lvl2.level === 2 && lvl2.alive === 55, 'a fresh wave of 55 spawns on level 2');
check(lvl2.fleetY > 44, `wave 2 starts lower (fleetY=${lvl2.fleetY})`);
check(lvl2.shieldPx > 250, 'shields are rebuilt for the new wave');
check(lvl2.lives === 3, `lives carry over into the next wave (${lvl2.lives})`);

log('\n=== fleet speeds up as invaders die ===');
await page.waitForFunction(() => window.__SI.game.state === 'play', null, { timeout: 8000 });
const speeds = await S(async () => {
  const g = window.__SI.game;
  const sample = async () => {
    const x0 = g.fleetX, y0 = g.fleetY, d0 = g.dir;
    let steps = 0, last = { x: x0, y: y0 };
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      if (g.fleetX !== last.x || g.fleetY !== last.y) { steps++; last = { x: g.fleetX, y: g.fleetY }; }
      await new Promise(r => setTimeout(r, 8));
    }
    return steps;
  };
  const slow = await sample();
  for (const a of g.aliens) if (a.alive && g.alive > 3) { a.alive = false; g.alive--; }
  const fast = await sample();
  return { slow, fast, left: g.alive };
});
check(speeds.fast > speeds.slow, `fleet accelerates as it thins out (${speeds.slow} -> ${speeds.fast} steps / 2.5s)`);

log('\n=== player death, lives and game over ===');
await S(() => { window.__SI.cheat.noBombs = false; window.__SI.cheat.invincible = false; });
const death = await S(async () => {
  const g = window.__SI.game;
  g.lives = 3; g.bombs.length = 0;
  const out = [];
  for (let n = 0; n < 4; n++) {
    if (g.state === 'over') break;
    g.bombs.push({ x: g.player.x + 5, y: 200, w: 3, h: 7, kind: 'roll', frame: 0, ft: 0, vy: 200 });
    const t0 = performance.now();
    while (g.state !== 'dying' && g.state !== 'over' && performance.now() - t0 < 2000)
      await new Promise(r => setTimeout(r, 20));
    out.push({ state: g.state, lives: g.lives });
    const t1 = performance.now();
    while ((g.state === 'dying') && performance.now() - t1 < 4000)
      await new Promise(r => setTimeout(r, 30));
    if (g.state === 'ready') {
      const t2 = performance.now();
      while (g.state === 'ready' && performance.now() - t2 < 3000) await new Promise(r => setTimeout(r, 30));
    }
  }
  return { out, state: g.state, lives: g.lives, score: g.score, hi: g.hi };
});
check(death.out.length >= 3, `a bomb hitting the cannon costs a life (${death.out.map(o => o.lives).join(',')})`);
check(death.state === 'over', 'game over after the last life is lost');
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/gp-gameover.png` });

log('\n=== high score persistence ===');
const stored = await S(() => { try { return localStorage.getItem('si.hiscore'); } catch (e) { return null; } });
check(stored && parseInt(stored, 10) === death.score, `high score written to storage (${stored})`);
await page.reload();
await page.waitForFunction(() => !!window.__SI);
const reHi = await S(() => window.__SI.game.hi);
check(reHi === death.score, `high score survives a reload (${reHi})`);

log('\n=== restart from the game over screen ===');
await S(() => { window.__SI.start(); const g = window.__SI.game; g.state = 'over'; g.timer = 0; });
const box = await page.locator('#stage').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.5);
await page.waitForTimeout(120);
const restarted = await S(() => {
  const g = window.__SI.game;
  return { state: g.state, score: g.score, lives: g.lives, level: g.level, alive: g.alive };
});
check(restarted.score === 0 && restarted.lives === 3 && restarted.level === 1 && restarted.alive === 55,
  'tapping game over starts a clean new game');

log('\n=== invasion ends the game ===');
const invasion = await S(async () => {
  const g = window.__SI.game;
  while (g.state !== 'play') await new Promise(r => setTimeout(r, 50));
  g.fleetY = 200;
  const t0 = performance.now();
  while (g.state === 'play' && performance.now() - t0 < 4000) await new Promise(r => setTimeout(r, 30));
  const s1 = g.state;
  const t1 = performance.now();
  while (g.state !== 'over' && performance.now() - t1 < 5000) await new Promise(r => setTimeout(r, 30));
  return { first: s1, final: g.state, invaded: g.invaded };
});
check(invasion.final === 'over' && invasion.invaded, 'invaders reaching the ground ends the game');
await page.screenshot({ path: `${SHOTS}/gp-invaded.png` });

log('\n=== performance ===');
await S(() => { window.__SI.start(); });
await page.waitForFunction(() => window.__SI.game.state === 'play');
const fps = await S(async () => {
  let n = 0; const t0 = performance.now();
  await new Promise(res => {
    const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  return n / ((performance.now() - t0) / 1000);
});
check(fps > 50, `renders at ${fps.toFixed(1)} fps with a full wave`);

check(errors.length === 0, 'no console/page errors (' + errors.slice(0, 4).join(' | ') + ')');

await browser.close();
log('\n' + (fails.length ? `${fails.length} FAILURE(S)` : 'ALL CHECKS PASSED'));
process.exit(fails.length ? 1 : 0);
