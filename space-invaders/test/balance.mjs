/* Measures the difficulty curve with a scripted player.
   node test/balance.mjs [games]                                        */
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.join(__dirname, '..', 'index.html');
const GAMES = parseInt(process.argv[2] || '8', 10);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await page.goto(FILE);
await page.waitForFunction(() => !!window.__SI);

/* how long an untouched fleet takes to reach the invasion line */
async function descentTime(level) {
  return page.evaluate(async (lvl) => {
    const S = window.__SI, g = S.game;
    S.start();
    g.level = lvl; S.cheat.noBombs = true; S.cheat.invincible = true;
    g.state = 'ready'; g.timer = 0.05;
    await new Promise(r => setTimeout(r, 300));
    // rebuild the fleet at this level's start height
    g.fleetY = 44 + Math.min(lvl - 1, 6) * 8;
    const t0 = performance.now();
    while (g.state === 'play' && performance.now() - t0 < 400000)
      await new Promise(r => setTimeout(r, 50));
    return (performance.now() - t0) / 1000;
  }, level);
}

/* a competent player: dodge, aim at the lowest invader in reach, fire when clear */
async function playGame() {
  return page.evaluate(async () => {
    const S = window.__SI, g = S.game;
    S.cheat.noBombs = false; S.cheat.invincible = false;
    S.start();
    const stats = { score: 0, level: 1, cause: '?', play: 0, shots: 0, kills: 0, idle: 0, busy: 0 };
    const T = [{ w: 8, o: 4 }, { w: 11, o: 2 }, { w: 12, o: 2 }];
    const t0 = performance.now();
    let last = t0, aliveWas = 55;

    while (g.state !== 'over' && performance.now() - t0 < 600000) {
      await new Promise(r => setTimeout(r, 16));
      const now = performance.now(), dt = (now - last) / 1000; last = now;
      if (g.state !== 'play') continue;
      stats.play += dt;
      if (g.bullet) stats.busy += dt; else stats.idle += dt;
      if (g.alive < aliveWas) { stats.kills += aliveWas - g.alive; }
      aliveWas = g.alive;

      const px = g.player.x + 6.5;
      // dodge: any bomb close overhead pushes us sideways
      let danger = null;
      for (const b of g.bombs)
        if (Math.abs(b.x + 1.5 - px) < 9 && b.y > 150 && b.y < 214)
          danger = b;
      if (danger) {
        g.player.x = Math.max(8, Math.min(203,
          g.player.x + (danger.x + 1.5 < px ? 1 : -1) * 2.4));
        continue;
      }
      // aim at the lowest invader in the nearest column
      let best = null, bestD = 1e9;
      for (const a of g.aliens) {
        if (!a.alive) continue;
        const ax = g.fleetX + a.col * 16 + T[a.type].o + T[a.type].w / 2;
        const d = Math.abs(ax - px) - a.row * 0.6;
        if (d < bestD) { bestD = d; best = { x: ax }; }
      }
      if (g.ufo && g.ufo.alive) best = { x: g.ufo.x + 8 };
      if (!best) continue;
      const want = best.x - 6.5;
      g.player.x = Math.max(8, Math.min(203,
        g.player.x + Math.max(-2.4, Math.min(2.4, want - g.player.x))));
      if (Math.abs(want - g.player.x) < 2 && !g.bullet) { S.fire(); stats.shots++; }
    }
    stats.score = g.score; stats.level = g.level;
    stats.cause = g.invaded ? 'invasion' : 'shot down';
    stats.maxLevel = g.level;
    return stats;
  });
}

const d1 = await descentTime(1), d5 = await descentTime(5), d10 = await descentTime(10);
console.log('untouched fleet reaches the ground:');
console.log(`  wave 1: ${d1.toFixed(1)}s   wave 5: ${d5.toFixed(1)}s   wave 10: ${d10.toFixed(1)}s`);

const runs = [];
for (let i = 0; i < GAMES; i++) runs.push(await playGame());

const scores = runs.map(r => r.score).sort((a, b) => a - b);
const idle = runs.reduce((a, r) => a + r.idle, 0);
const busy = runs.reduce((a, r) => a + r.busy, 0);
const cleared = runs.filter(r => r.maxLevel > 1).length;
console.log(`\n${GAMES} games by a competent bot:`);
console.log('  score   min/median/max :', scores[0], scores[(scores.length / 2) | 0], scores[scores.length - 1]);
console.log('  waves reached          :', runs.map(r => r.maxLevel).join(','));
console.log('  cleared wave 1         :', cleared, '/', GAMES);
console.log('  game length (s)        :', runs.map(r => Math.round(r.play)).join(','));
console.log('  ended by               :', JSON.stringify(runs.reduce((a, r) => { a[r.cause] = (a[r.cause] || 0) + 1; return a; }, {})));
console.log('  barrel idle share      :', (idle / (idle + busy) * 100).toFixed(1) + '%');
console.log('  accuracy               :', runs.reduce((a, r) => a + r.kills, 0) + '/' + runs.reduce((a, r) => a + r.shots, 0));

await browser.close();
