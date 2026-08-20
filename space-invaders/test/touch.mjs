/* Regression tests for the touch-input defects found in QA.
   Uses real multi-touch via CDP Input.dispatchTouchEvent. */
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.join(__dirname, '..', 'index.html');

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

async function fresh(deviceName = 'iPhone 13') {
  const ctx = await browser.newContext({ ...devices[deviceName] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(FILE);
  await page.waitForFunction(() => !!window.__SI);
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 5, radiusY: 5, force: 1 })),
    });
  return { ctx, page, cdp, touch, errors };
}
async function play(page) {
  await page.evaluate(() => {
    window.__SI.start();
    window.__SI.cheat.noBombs = true;
    window.__SI.cheat.invincible = true;
    window.__SI.game.state = 'play';
  });
  await page.waitForFunction(() => window.__SI.game.state === 'play');
}
const shipX = page => page.evaluate(() => window.__SI.game.player.x);

/* ---- 1. a resting second finger must not hijack steering ---- */
{
  const { ctx, page, touch } = await fresh();
  await play(page);
  const box = await page.locator('#stage').boundingBox();
  const y = box.y + box.height * 0.6;
  const a = { id: 1, x: box.x + box.width * 0.25, y }, b = { id: 2, x: box.x + box.width * 0.75, y };
  await touch('touchStart', [a]);
  await touch('touchStart', [a, b]);
  await touch('touchMove', [{ ...a, x: a.x + 100 }, b]);
  await page.waitForTimeout(80);
  const steered = await shipX(page);
  await touch('touchMove', [{ ...a, x: a.x + 100 }, { ...b, x: b.x + 2 }]);
  await page.waitForTimeout(80);
  const after = await shipX(page);
  check(Math.abs(after - steered) < 3,
    `a resting second finger does not hijack steering (${steered.toFixed(1)} -> ${after.toFixed(1)})`);
  await touch('touchEnd', []);
  await ctx.close();
}

/* ---- 2. an idle finger must not disable the D-pad ---- */
{
  const { ctx, page, touch } = await fresh();
  await play(page);
  const box = await page.locator('#stage').boundingBox();
  await touch('touchStart', [{ id: 1, x: box.x + box.width / 2, y: box.y + box.height * 0.5 }]);
  await page.waitForTimeout(50);
  const before = await shipX(page);
  await page.locator('#btnLeft').dispatchEvent('pointerdown', { pointerId: 9, isPrimary: true, button: 0 });
  await page.waitForTimeout(300);
  const after = await shipX(page);
  await page.locator('#btnLeft').dispatchEvent('pointerup', { pointerId: 9, isPrimary: true, button: 0 });
  check(after < before - 15,
    `LEFT button still steers with an idle finger on the field (${before.toFixed(1)} -> ${after.toFixed(1)})`);
  await touch('touchEnd', []);
  await ctx.close();
}

/* ---- 3. rotating mid-drag must not teleport the ship ---- */
{
  const { ctx, page, touch } = await fresh();
  await play(page);
  let box = await page.locator('#stage').boundingBox();
  const p = { id: 1, x: box.x + box.width / 2, y: box.y + box.height * 0.5 };
  await touch('touchStart', [p]);
  await page.waitForTimeout(50);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  const before = await shipX(page);
  box = await page.locator('#stage').boundingBox();
  await touch('touchMove', [{ ...p, x: p.x + 6 }]);
  await page.waitForTimeout(80);
  const after = await shipX(page);
  check(Math.abs(after - before) < 12,
    `rotating mid-drag does not teleport the cannon (${before.toFixed(1)} -> ${after.toFixed(1)})`);
  await touch('touchEnd', []);
  await ctx.close();
}

/* ---- 4. no clamp wind-up: reversing the stroke moves immediately ---- */
{
  const { ctx, page, touch } = await fresh();
  await play(page);
  const box = await page.locator('#stage').boundingBox();
  const y = box.y + box.height * 0.6;
  const p = { id: 1, x: box.x + box.width / 2, y };
  await touch('touchStart', [p]);
  // press hard into the left wall (CDP clamps touches to the viewport, so walk
  // it to the edge in steps to build up the overshoot the anchor must absorb)
  for (let i = 0; i < 6; i++) {
    await touch('touchMove', [{ ...p, x: box.x + 2 }]);
    await page.waitForTimeout(25);
  }
  const wall = await shipX(page);
  // come back a small amount
  await touch('touchMove', [{ ...p, x: box.x + 22 }]);
  await page.waitForTimeout(80);
  const back = await shipX(page);
  check(wall <= 8.5, `drag reaches the left wall (${wall.toFixed(1)})`);
  check(back > wall + 8, `reversing off the wall responds at once (${wall.toFixed(1)} -> ${back.toFixed(1)})`);
  await touch('touchEnd', []);
  await ctx.close();
}

/* ---- 5. a press held through a state change survives it ---- */
{
  // 5a: hold FIRE from the attract screen
  const { ctx, page } = await fresh();
  await page.locator('#btnFire').dispatchEvent('pointerdown', { pointerId: 3, isPrimary: true, button: 0 });
  await page.waitForTimeout(60);
  const started = await page.evaluate(() => window.__SI.game.state);
  await page.evaluate(() => { window.__SI.game.state = 'play'; window.__SI.cheat.noBombs = true; });
  await page.waitForTimeout(300);
  const fired = await page.evaluate(() => window.__SI.game.shotCount);
  await page.locator('#btnFire').dispatchEvent('pointerup', { pointerId: 3, isPrimary: true, button: 0 });
  check(started === 'ready' || started === 'play', 'FIRE on the attract screen starts the game');
  check(fired > 0, `FIRE held through the start keeps firing (${fired} shots)`);
  await ctx.close();
}
{
  // 5b: hold LEFT from the attract screen
  const { ctx, page } = await fresh();
  await page.locator('#btnLeft').dispatchEvent('pointerdown', { pointerId: 4, isPrimary: true, button: 0 });
  await page.waitForTimeout(60);
  await page.evaluate(() => { window.__SI.game.state = 'play'; window.__SI.cheat.noBombs = true; });
  const before = await shipX(page);
  await page.waitForTimeout(300);
  const after = await shipX(page);
  await page.locator('#btnLeft').dispatchEvent('pointerup', { pointerId: 4, isPrimary: true, button: 0 });
  check(after < before - 15, `LEFT held through the start steers (${before.toFixed(1)} -> ${after.toFixed(1)})`);
  await ctx.close();
}
{
  // 5c: a finger that starts the game can steer with the same stroke
  const { ctx, page, touch } = await fresh();
  const box = await page.locator('#stage').boundingBox();
  const p = { id: 1, x: box.x + box.width / 2, y: box.y + box.height * 0.6 };
  await touch('touchStart', [p]);
  await page.waitForTimeout(60);
  await page.evaluate(() => { window.__SI.game.state = 'play'; window.__SI.cheat.noBombs = true; });
  const before = await shipX(page);
  await touch('touchMove', [{ ...p, x: p.x + 70 }]);
  await page.waitForTimeout(100);
  const after = await shipX(page);
  check(after > before + 15, `the finger that starts the game can steer it (${before.toFixed(1)} -> ${after.toFixed(1)})`);
  await touch('touchEnd', []);
  await ctx.close();
}
{
  // 5d: pressing during the game-over lockout restarts once it expires
  const { ctx, page } = await fresh();
  await page.evaluate(() => {
    window.__SI.start();
    const g = window.__SI.game;
    g.state = 'over'; g.timer = 0.7; g.score = 120;
  });
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.waitForTimeout(1400);
  const state = await page.evaluate(() => window.__SI.game.state);
  await page.mouse.up();
  check(state !== 'over', `a press during the game-over lockout restarts when it lifts (state=${state})`);
  await ctx.close();
}

/* ---- 6. two fingers on one button: releasing the second keeps the hold ---- */
{
  const { ctx, page } = await fresh();
  await play(page);
  const btn = page.locator('#btnLeft');
  await btn.dispatchEvent('pointerdown', { pointerId: 11, isPrimary: true, button: 0 });
  await btn.dispatchEvent('pointerdown', { pointerId: 12, isPrimary: false, button: 0 });
  await page.evaluate(() => { window.__SI.game.player.x = 150; });
  await btn.dispatchEvent('pointerup', { pointerId: 12, isPrimary: false, button: 0 });
  const before = await shipX(page);
  await page.waitForTimeout(300);
  const after = await shipX(page);
  await btn.dispatchEvent('pointerup', { pointerId: 11, isPrimary: true, button: 0 });
  check(after < before - 15,
    `lifting the second finger keeps the button held (${before.toFixed(1)} -> ${after.toFixed(1)})`);
  const released = await page.evaluate(() => window.__SI.input.left);
  check(released === false, 'lifting the last finger releases the button');
  await ctx.close();
}

/* ---- 7. a cancelled touch is not a tap ---- */
{
  const { ctx, page, touch } = await fresh();
  await play(page);
  const box = await page.locator('#stage').boundingBox();
  await page.evaluate(() => { window.__SI.game.shotCount = 0; window.__SI.game.bullet = null; });
  await touch('touchStart', [{ id: 1, x: box.x + box.width / 2, y: box.y + box.height * 0.6 }]);
  await page.waitForTimeout(60);
  await touch('touchCancel', []);
  await page.waitForTimeout(80);
  const shots = await page.evaluate(() => window.__SI.game.shotCount);
  check(shots === 0, `touchcancel does not fire a shot (${shots} shots)`);
  await ctx.close();
}

/* ---- 8. floating landscape pad must not overlap the playfield ---- */
{
  const sizes = [[568, 320], [640, 480], [844, 390], [800, 360], [1024, 512]];
  const { ctx, page } = await fresh();
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    const bad = await page.evaluate(() => {
      const s = document.getElementById('stage').getBoundingClientRect();
      const v = window.__SI.view;
      const f = {
        l: s.left + v.cssOx, t: s.top + v.cssOy,
        r: s.left + v.cssOx + 224 * v.cssK, b: s.top + v.cssOy + 256 * v.cssK,
      };
      const out = [];
      for (const id of ['btnLeft', 'btnRight', 'btnFire', 'btnSound', 'btnCrt', 'btnPause', 'btnFull', 'btnShare']) {
        const el = document.getElementById(id);
        if (!el || el.classList.contains('hidden') || !el.offsetParent) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < f.r - 2 && r.right > f.l + 2 && r.top < f.b - 2 && r.bottom > f.t + 2) out.push(id);
      }
      return out;
    });
    check(bad.length === 0, `no control overlaps the playfield at ${w}x${h} (${bad.join(',') || 'none'})`);
  }
  await ctx.close();
}

/* ---- 9. tool buttons meet the 44px touch target minimum ---- */
{
  const { ctx, page } = await fresh();
  const small = await page.evaluate(() => {
    const out = [];
    for (const id of ['btnSound', 'btnCrt', 'btnPause', 'btnFull', 'btnShare']) {
      const el = document.getElementById(id);
      if (!el || el.classList.contains('hidden') || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) out.push(`${id} ${r.width | 0}x${r.height | 0}`);
    }
    return out;
  });
  check(small.length === 0, `tool buttons are at least 44x44 (${small.join(', ') || 'all ok'})`);
  await ctx.close();
}

/* ---- 10. the whole field is reachable from a thumb planted off-centre ---- */
{
  const { ctx, page, touch } = await fresh();
  await play(page);
  const box = await page.locator('#stage').boundingBox();
  const y = box.y + box.height * 0.6;
  // guarantee: a thumb anywhere in the middle half of the screen reaches both walls
  for (const frac of [0.25, 0.5, 0.75]) {
    await page.evaluate(() => { window.__SI.game.player.x = 105; });
    const p = { id: 1, x: box.x + box.width * frac, y };
    await touch('touchStart', [p]);
    await touch('touchMove', [{ ...p, x: box.x + 2 }]);
    await page.waitForTimeout(80);
    const lo = await shipX(page);
    await touch('touchMove', [{ ...p, x: box.x + box.width - 2 }]);
    await page.waitForTimeout(80);
    const hi = await shipX(page);
    await touch('touchEnd', []);
    check(lo <= 9 && hi >= 202,
      `both field edges reachable from a thumb at ${frac * 100}% (${lo.toFixed(1)}..${hi.toFixed(1)})`);
  }
  await ctx.close();
}

await browser.close();
log('\n' + (fails.length ? `${fails.length} FAILURE(S)` : 'ALL CHECKS PASSED'));
process.exit(fails.length ? 1 : 0);
