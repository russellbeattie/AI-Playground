import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.join(__dirname, '..', 'index.html');
const SHOTS = path.join(__dirname, '..', '.shots');

const profiles = [
  { name: 'iphone13', ...devices['iPhone 13'] },
  { name: 'iphone13-landscape', ...devices['iPhone 13 landscape'] },
  { name: 'pixel7', ...devices['Pixel 7'] },
  { name: 'ipad', ...devices['iPad Mini'] },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 2 },
];

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

for (const p of profiles) {
  const { name, ...opts } = p;
  log('\n=== ' + name + ' ===');
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(FILE);
  await page.waitForFunction(() => !!window.__SI, null, { timeout: 5000 });
  await page.waitForTimeout(400);

  // --- attract screen
  let st = await page.evaluate(() => window.__SI.game.state);
  check(st === 'attract', 'boots into attract mode');
  await page.screenshot({ path: `${SHOTS}/${name}-1-attract.png` });

  // --- layout sanity: playfield fits inside the stage
  const geo = await page.evaluate(() => {
    const v = window.__SI.view;
    const s = document.getElementById('stage').getBoundingClientRect();
    const tools = document.getElementById('tools').getBoundingClientRect();
    return {
      k: v.cssK, ox: v.cssOx, oy: v.cssOy,
      fieldW: 224 * v.cssK, fieldH: 256 * v.cssK,
      stageW: s.width, stageH: s.height,
      toolsBottom: tools.bottom, toolsLeft: tools.left,
      canvasW: document.getElementById('game').width,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      docScrollH: document.documentElement.scrollHeight,
      docClientH: document.documentElement.clientHeight,
    };
  });
  check(geo.k > 0, 'scale is positive (' + geo.k.toFixed(2) + ')');
  check(geo.ox >= -0.5 && geo.oy >= -0.5, 'playfield origin is on-screen');
  check(geo.ox + geo.fieldW <= geo.stageW + 0.5, 'playfield fits horizontally');
  check(geo.oy + geo.fieldH <= geo.stageH + 0.5, 'playfield fits vertically');
  check(geo.oy >= geo.toolsBottom - 1, 'playfield starts below the tool buttons');
  check(geo.docScrollW <= geo.docClientW, 'no horizontal page scroll');
  check(geo.docScrollH <= geo.docClientH + 1, 'no vertical page scroll');

  // --- start the game with a tap / click in the middle of the stage
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
  await page.waitForTimeout(100);
  st = await page.evaluate(() => window.__SI.game.state);
  check(st === 'ready' || st === 'play', 'tap starts the game (state=' + st + ')');

  const fleet = await page.evaluate(() => {
    const g = window.__SI.game;
    return { alive: g.alive, aliens: g.aliens.length, shields: g.shields.length, lives: g.lives, level: g.level };
  });
  check(fleet.aliens === 55 && fleet.alive === 55, '55 invaders spawned');
  check(fleet.shields === 4, '4 shields');
  check(fleet.lives === 3, '3 lives');

  await page.waitForTimeout(1700);
  st = await page.evaluate(() => window.__SI.game.state);
  check(st === 'play', 'enters play after the ready countdown');
  await page.screenshot({ path: `${SHOTS}/${name}-2-play.png` });

  // --- controls: drag to move
  const before = await page.evaluate(() => window.__SI.game.player.x);
  const cx = box.x + box.width / 2, cy = box.y + box.height * 0.6;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy, { steps: 8 });
  await page.waitForTimeout(80);
  const during = await page.evaluate(() => window.__SI.game.player.x);
  await page.mouse.up();
  check(during > before, 'drag right moves the cannon right (' + before.toFixed(1) + ' -> ' + during.toFixed(1) + ')');

  const b2 = await page.evaluate(() => window.__SI.game.player.x);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 70, cy, { steps: 8 });
  await page.waitForTimeout(80);
  const d2 = await page.evaluate(() => window.__SI.game.player.x);
  await page.mouse.up();
  check(d2 < b2, 'drag left moves the cannon left');

  // clamped inside the field
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 4000, cy, { steps: 4 });
  await page.waitForTimeout(60);
  const minX = await page.evaluate(() => window.__SI.game.player.x);
  await page.mouse.move(cx + 4000, cy, { steps: 4 });
  await page.waitForTimeout(60);
  const maxX = await page.evaluate(() => window.__SI.game.player.x);
  await page.mouse.up();
  check(minX >= 7.9 && maxX <= 224 - 8 - 13 + 0.1, 'cannon stays inside the field (' + minX.toFixed(1) + '..' + maxX.toFixed(1) + ')');

  // --- tap to fire
  await page.evaluate(() => { window.__SI.game.bullet = null; });
  await page.mouse.click(cx, cy, { delay: 30 });
  const shot = await page.evaluate(() => !!window.__SI.game.bullet || window.__SI.game.shotCount > 0);
  check(shot, 'tap fires a shot');

  // --- on-screen buttons exist and work on touch profiles
  if (opts.hasTouch) {
    const padVisible = await page.evaluate(() => getComputedStyle(document.getElementById('pad')).display !== 'none');
    check(padVisible, 'touch pad is visible');
    const fireBox = await page.locator('#btnFire').boundingBox();
    check(fireBox && fireBox.width >= 44 && fireBox.height >= 44, 'fire button is at least 44x44 (' + (fireBox ? `${fireBox.width | 0}x${fireBox.height | 0}` : 'missing') + ')');
    const lBox = await page.locator('#btnLeft').boundingBox();
    check(lBox && lBox.width >= 44 && lBox.height >= 44, 'left button is at least 44x44');
    // buttons must not overlap the playfield drawing area
    const overlap = await page.evaluate(() => {
      const s = document.getElementById('stage').getBoundingClientRect();
      const v = window.__SI.view;
      const field = { l: s.left + v.cssOx, t: s.top + v.cssOy, r: s.left + v.cssOx + 224 * v.cssK, b: s.top + v.cssOy + 256 * v.cssK };
      const out = [];
      for (const id of ['btnLeft', 'btnRight', 'btnFire', 'btnSound', 'btnCrt', 'btnPause', 'btnFull', 'btnShare']) {
        const el = document.getElementById(id);
        if (!el || el.classList.contains('hidden') || !el.offsetParent) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < field.r - 2 && r.right > field.l + 2 && r.top < field.b - 2 && r.bottom > field.t + 2) out.push(id);
      }
      return out;
    });
    check(overlap.length === 0, 'no control button overlaps the playfield (' + (overlap.join(',') || 'none') + ')');

    // hold the left button
    const px = await page.evaluate(() => window.__SI.game.player.x);
    await page.locator('#btnLeft').dispatchEvent('pointerdown', { pointerId: 5, isPrimary: true, button: 0 });
    await page.waitForTimeout(220);
    const px2 = await page.evaluate(() => window.__SI.game.player.x);
    await page.locator('#btnLeft').dispatchEvent('pointerup', { pointerId: 5, isPrimary: true, button: 0 });
    check(px2 < px, 'holding LEFT button moves the cannon');
  }

  // --- keyboard on desktop
  if (!opts.hasTouch) {
    const kx = await page.evaluate(() => { window.__SI.game.player.x = 100; return 100; });
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(220);
    await page.keyboard.up('ArrowRight');
    const kx2 = await page.evaluate(() => window.__SI.game.player.x);
    check(kx2 > kx, 'ArrowRight moves the cannon');
    await page.evaluate(() => { window.__SI.game.bullet = null; });
    await page.keyboard.press('Space');
    await page.waitForTimeout(30);
    const kshot = await page.evaluate(() => !!window.__SI.game.bullet);
    check(kshot, 'Space fires');
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(60);
    check(await page.evaluate(() => window.__SI.game.state) === 'paused', 'P pauses');
    await page.screenshot({ path: `${SHOTS}/${name}-3-paused.png` });
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(60);
    check(await page.evaluate(() => window.__SI.game.state) === 'play', 'P resumes');
  }

  check(errors.length === 0, 'no console/page errors (' + errors.slice(0, 3).join(' | ') + ')');
  await ctx.close();
}

await browser.close();
log('\n' + (fails.length ? `${fails.length} FAILURE(S)` : 'ALL CHECKS PASSED'));
process.exit(fails.length ? 1 : 0);
