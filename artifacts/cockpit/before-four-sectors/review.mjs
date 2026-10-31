import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const outputDirectory = path.resolve("artifacts/cockpit");
await mkdir(outputDirectory, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "skyphantoms-review-"));
const browser = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--in-process-gpu",
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--disable-background-networking", "--remote-debugging-port=0",
  "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "about:blank"
], { stdio: "ignore", windowsHide: true });

let connection;
let messageId = 0;
const pending = new Map();
const errors = [];
const checks = [];

function send(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timeout });
    connection.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function waitForPage() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await evaluate("document.querySelectorAll('.instrument').length === 8 && document.readyState === 'complete'")) return;
    await delay(100);
  }
  throw new Error("Page did not initialize");
}

async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })`);
  const point = await evaluate(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

async function typeText(selector, text) {
  await click(selector);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await send("Input.insertText", { text });
}

async function dragSlider(selector) {
  const rectangle = await evaluate(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: rectangle.left + 7, y: rectangle.y });
  for (let step = 1; step <= 12; step += 1) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: rectangle.left + 7 + (rectangle.right - rectangle.left - 14) * step / 12, y: rectangle.y });
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: rectangle.right - 7, y: rectangle.y });
}

async function storedState() {
  await delay(250);
  return evaluate("JSON.parse(localStorage.getItem('skyphantoms-cockpit-v1'))");
}

async function dialPoint(key, angle) {
  return evaluate(`(() => {
    const dial = document.querySelector('[data-stat="${key}"]');
    const touchRadius = Number(dial.querySelector('.dial-touch').getAttribute('r')) * .74;
    const angle = ${angle} * Math.PI / 180;
    const point = new DOMPoint(Math.sin(angle) * touchRadius, -Math.cos(angle) * touchRadius).matrixTransform(dial.getScreenCTM());
    return {x: point.x, y: point.y};
  })()`);
}

async function dragDial(key, target) {
  const current = await evaluate(`Number(document.querySelector('[data-stat="${key}"]').getAttribute('aria-valuenow'))`);
  const startAngle = -135 + (current - 1) * 67.5;
  const targetAngle = -135 + (target - 1) * 67.5;
  const start = await dialPoint(key, startAngle);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...start });
  for (let step = 1; step <= 15; step += 1) {
    const point = await dialPoint(key, startAngle + (targetAngle - startAngle) * step / 15);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, ...point });
  }
  const end = await dialPoint(key, targetAngle);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...end });
  assert.equal(await evaluate(`Number(document.querySelector('[data-stat="${key}"]').getAttribute('aria-valuenow'))`), target);
  assert.equal(await evaluate(`document.querySelector('[data-stat="${key}"] .dial-needle').getAttribute('transform')`), `rotate(${targetAngle})`);
  assert.equal(await evaluate("document.querySelectorAll('.dragging').length"), 0);
}

async function screenshot(name) {
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(outputDirectory, name), Buffer.from(result.data, "base64"));
}

try {
  let port;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const content = await readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      port = Number(content.split("\n")[0]);
      break;
    } catch { await delay(100); }
  }
  assert.ok(port, "Chrome remote debugging started in an isolated temporary profile");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  connection = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    connection.addEventListener("open", resolve, { once: true });
    connection.addEventListener("error", reject, { once: true });
  });
  connection.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(callback.timeout);
      if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
      else callback.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error" && !message.params.entry.url?.endsWith("favicon.ico")) errors.push(message.params.entry);
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://127.0.0.1:8765/" });
  await waitForPage();
  assert.equal(await evaluate("document.querySelectorAll('#cockpit image').length"), 3);
  assert.equal(await evaluate("[...document.querySelectorAll('#cockpit image')].every(element => element.getAttribute('href') === 'assets/imperial-skies.png')"), true);
  assert.equal((await storedState()).stats.mobility, 3);
  assert.equal(await evaluate("document.querySelector('#points-counter').textContent"), "24 / 24");
  await screenshot("redesign-first.png");
  checks.push("Eight SVG instruments initialize with the exact character-sheet values and use a local generated panorama");

  assert.equal(await evaluate("document.querySelectorAll('.skill-row').length"), 10);
  assert.equal(await evaluate("document.querySelector('.scene-frame').contains(document.querySelector('.skills-panel'))"), true);
  const kneeboardHeight = await evaluate("document.querySelector('.skills-panel').getBoundingClientRect().height");
  await click("#skills-expand");
  assert.equal(await evaluate("document.querySelector('#skills-dialog').open && document.querySelector('#skills-dialog').contains(document.querySelector('.skills-panel'))"), true);
  await typeText("#skill-name-0", "Пилотирование");
  await dragSlider("#skill-level-0");
  assert.equal(await evaluate("document.querySelector('#skill-value-0').value"), "+5");
  assert.equal((await storedState()).skills[0].name, "Пилотирование");
  assert.equal((await storedState()).skills[0].value, 5);
  await typeText("#skill-name-9", "Первая помощь");
  await evaluate("document.querySelector('#skill-level-9').focus()");
  for (const key of ["End", "Home", "ArrowRight"]) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key });
  }
  assert.equal((await storedState()).skills[9].value, 1);
  assert.equal((await storedState()).skills[9].name, "Первая помощь");
  const expandedHeight = await evaluate("document.querySelector('.skills-panel').getBoundingClientRect().height");
  for (let count = 11; count <= 25; count += 1) {
    await click("#add-skill");
    assert.equal(await evaluate("document.querySelectorAll('.skill-row').length"), count);
  }
  assert.equal(await evaluate("document.querySelector('#add-skill').disabled"), true);
  await click("#add-skill");
  assert.equal(await evaluate("document.querySelectorAll('.skill-row').length"), 25);
  assert.equal(await evaluate("document.querySelector('.skills-panel').getBoundingClientRect().height"), expandedHeight);
  assert.equal(await evaluate("(() => { const list = document.querySelector('#skills-list'); return list.scrollHeight > list.clientHeight && list.scrollTop > 0 && Math.abs(list.clientHeight / list.firstElementChild.getBoundingClientRect().height - 10) < .1; })()"), true);
  await typeText("#skill-name-24", "Высший пилотаж");
  await dragSlider("#skill-level-24");
  assert.equal((await storedState()).skills[24].value, 5);
  await screenshot("skills-tablet.png");
  await click("#skills-dialog .close-button");
  assert.equal(await evaluate("document.querySelector('.scene-frame').contains(document.querySelector('.skills-panel'))"), true);
  assert.equal(await evaluate("document.querySelector('.skills-panel').getBoundingClientRect().height"), kneeboardHeight);
  checks.push("The kneeboard keeps its size and ten visible rows; plus adds exactly one skill up to 25, scrolls internally, disables at the limit, and retains 0–5 bonuses");

  assert.equal(await evaluate("document.querySelectorAll('#annunciators .structure-button').length"), 5);
  assert.equal(await evaluate("document.querySelector('#flight-clock') === null"), true);
  assert.equal((await storedState()).aircraft.technicalLimit, 5);
  for (let remaining = 7; remaining >= 0; remaining -= 1) {
    await click('#annunciators [data-structure-node="wings"]');
    assert.equal((await storedState()).aircraft.nodes.wings.current, remaining);
  }
  assert.equal(await evaluate("document.querySelector('#annunciators [data-structure-node=wings]').getAttribute('aria-label').includes('Штопор')"), true);
  await click('#annunciators [data-structure-node="wings"]');
  assert.equal((await storedState()).aircraft.nodes.wings.current, 8);
  for (let press = 0; press < 6; press += 1) await click('#annunciators [data-structure-node="engine"]');
  assert.equal((await storedState()).aircraft.nodes.engine.current, 2);
  assert.equal(await evaluate("document.querySelector('#annunciators [data-structure-node=engine]').getAttribute('aria-label').includes('Скорость −1')"), true);
  await click('#annunciators [data-structure-node="engine"]');
  await click('#annunciators [data-structure-node="engine"]');
  assert.equal(await evaluate("document.querySelector('#annunciators [data-structure-node=engine]').getAttribute('aria-label').includes('Заглох')"), true);
  await click('#annunciators [data-structure-node="engine"]');
  await click('#annunciators [data-structure-node="engine"]');
  await click('#annunciators [data-structure-node="engine"]');
  for (const key of ["fuel", "weapons", "cockpit"]) {
    await click(`#annunciators [data-structure-node="${key}"]`);
    assert.equal((await storedState()).aircraft.nodes[key].current, 7);
  }
  checks.push("All five aircraft nodes match the PDF hit ranges; clicks subtract one STR, zero shows the failure state, the next click fully restores, and nodes track damage independently");

  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  assert.equal(await evaluate("document.querySelector('#afterburner-counter').dataset.value"), "2");
  await click("#afterburner-spend");
  assert.equal(await evaluate("document.querySelector('#afterburner-counter').dataset.value"), "1");
  assert.equal(await evaluate("document.querySelector('#afterburner-units').getAnimations().some(animation => animation.playState === 'running')"), true);
  await click("#afterburner-spend");
  await click("#afterburner-spend");
  assert.equal(await evaluate("document.querySelector('#afterburner-counter').dataset.value"), "0");
  assert.equal(await evaluate("document.querySelector('#afterburner-spend').getAttribute('aria-disabled')"), "true");
  await click("#afterburner-refill");
  assert.equal(await evaluate("document.querySelector('#afterburner-counter').dataset.value"), "2");

  const statsBeforeAircraft = (await storedState()).stats;
  assert.equal(await evaluate("document.querySelector('#aircraft-speed-readout').textContent"), "3");
  assert.equal(await evaluate("document.querySelector('#aircraft-maneuverability-readout').textContent"), "4");
  assert.equal(await evaluate("document.querySelector('#aircraft-armor-readout').textContent"), "0");
  assert.equal(await evaluate("document.querySelector('#aircraft-slots-readout').textContent"), "03 / 10");
  assert.equal(await evaluate("document.querySelector('#aircraft-panel').getBoundingClientRect().bottom < document.querySelector('#resource-radio').getBoundingClientRect().top"), true);
  await click("#aircraft-panel");
  assert.equal(await evaluate("document.querySelector('#aircraft-dialog').open"), true);
  assert.equal(await evaluate("document.querySelectorAll('.aircraft-slot').length"), 3);
  assert.equal(await evaluate("document.querySelectorAll('.structure-row').length"), 5);
  await typeText("#node-wings-armor", "2");
  assert.equal(await evaluate("document.querySelectorAll('#node-wings-armor-cells rect').length"), 2);
  assert.equal(await evaluate("document.querySelector('#node-engine-armor-cells').childElementCount"), 0);
  assert.equal(await evaluate("document.querySelector('#node-wings-armor').closest('.structure-row').querySelector('.node-armor-cells').hidden"), false);
  await typeText("#aircraft-technical-limit", "4");
  assert.equal((await storedState()).aircraft.nodes.wings.current, 7);
  assert.equal((await storedState()).aircraft.nodes.engine.current, 6);
  await typeText("#node-wings-maximum", "10");
  await typeText("#node-engine-maximum", "11");
  assert.equal((await storedState()).aircraft.nodes.wings.current, 10);
  assert.equal((await storedState()).aircraft.nodes.wings.maximum, 10);
  assert.equal((await storedState()).aircraft.nodes.engine.maximum, 10);
  assert.equal((await storedState()).aircraft.nodes.engine.current, 6);
  assert.equal(await evaluate("document.querySelectorAll('#node-wings-cells rect').length"), 10);
  for (let press = 0; press < 10; press += 1) await click('#aircraft-structure [data-structure-node="wings"]');
  assert.equal((await storedState()).aircraft.nodes.wings.current, 0);
  assert.equal(await evaluate("document.querySelectorAll('#node-wings-armor-cells rect').length"), 2);
  await click('#aircraft-structure [data-structure-node="wings"]');
  assert.equal((await storedState()).aircraft.nodes.wings.current, 10);
  checks.push("Each aircraft node has an independent 1–10 maximum; full nodes follow new maxima, damage is preserved, and armor adds a separate blue bar only above zero");
  await typeText("#aircraft-technical-limit", "5");
  assert.equal((await storedState()).aircraft.nodes.wings.current, 10);
  assert.equal((await storedState()).aircraft.nodes.fuel.maximum, 8);
  assert.equal((await storedState()).aircraft.nodes.engine.current, 6);
  await typeText("#aircraft-afterburner-capacity", "12");
  await typeText("#aircraft-afterburners", "10");
  assert.deepEqual((await storedState()).aircraft.slots.slice(0, 3), [{name: "Носовая пушка", effect: "Урон 2"}, {name: "Форсаж", effect: "2 раза"}, {name: "Дымовая завеса", effect: ""}]);
  await typeText("#aircraft-speed", "6");
  for (let count = 4; count <= 10; count += 1) {
    await click("#add-aircraft-slot");
    assert.equal(await evaluate("document.querySelectorAll('.aircraft-slot').length"), count);
  }
  assert.equal(await evaluate("document.querySelector('#add-aircraft-slot').disabled"), true);
  await click("#add-aircraft-slot");
  assert.equal(await evaluate("document.querySelectorAll('.aircraft-slot').length"), 10);
  await typeText("#aircraft-slot-name-3", "Бомбы");
  await typeText("#aircraft-slot-effect-3", "Урон 3 / 2 шт.");
  await typeText("#aircraft-slot-name-9", "Световые ловушки");
  await typeText("#aircraft-slot-effect-9", "3 раза");
  assert.equal(await evaluate("document.querySelector('#aircraft-slot-count').textContent"), "Занято: 5 / 10");
  assert.equal(await evaluate("document.querySelector('#aircraft-speed-readout').textContent"), "6");
  assert.deepEqual((await storedState()).stats, statsBeforeAircraft);
  await screenshot("aircraft-passport.png");
  await click("#aircraft-dialog .close-button");
  await click("#afterburner-spend");
  await delay(500);
  assert.equal((await storedState()).aircraft.afterburners, 9);
  assert.equal(await evaluate("Math.round(-new DOMMatrix(getComputedStyle(document.querySelector('#afterburner-tens')).transform).m42 / 34) % 10"), 0);
  assert.equal(await evaluate("Math.round(-new DOMMatrix(getComputedStyle(document.querySelector('#afterburner-units')).transform).m42 / 34) % 10"), 9);
  await click("#aircraft-panel");
  await typeText("#aircraft-afterburner-capacity", "125");
  await typeText("#aircraft-afterburners", "100");
  assert.equal((await storedState()).aircraft.afterburnerCapacity, 125);
  assert.equal((await storedState()).aircraft.afterburners, 100);
  await click("#aircraft-dialog .close-button");
  await click("#afterburner-spend");
  await delay(500);
  assert.equal((await storedState()).aircraft.afterburners, 99);
  assert.deepEqual(await evaluate("['hundreds', 'tens', 'units'].map(place => Math.round(-new DOMMatrix(getComputedStyle(document.querySelector('#afterburner-' + place)).transform).m42 / 34) % 10)"), [0, 9, 9]);
  checks.push("The three-digit afterburner odometer supports up to 999 charges, animates 100→099 and 010→009 correctly, and spends/refills without going negative");
  checks.push("Equipment starts with three supplied modules, plus adds one row at a time up to the default capacity of ten, and occupied slots remain independent of character stats");

  for (const [key, value] of [["mobility", 5], ["reaction", 1], ["awareness", 4], ["composure", 2], ["athleticism", 3], ["charisma", 5], ["luck", 5]]) await dragDial(key, value);
  assert.equal((await storedState()).stats.mobility, 5);
  checks.push("Real mouse drags rotate the needles above the scale, snap to the matching number and persist");

  await dragDial("vitality", 2);
  assert.equal(await evaluate("document.querySelector('#hp-readout').textContent"), "04 / 04");
  await click('[data-resource="hp"][data-delta="-1"]');
  assert.equal(await evaluate("document.querySelector('#hp-readout').textContent"), "03 / 04");
  assert.equal(await evaluate("document.querySelectorAll('.hp-segment.damaged').length"), 3);
  assert.equal(await evaluate("document.querySelector('#lamp-health').classList.contains('warning-lit')"), false);
  await click('[data-resource="hp"][data-delta="-1"]');
  assert.equal(await evaluate("document.querySelectorAll('.hp-segment.damaged').length"), 5);
  assert.equal(await evaluate("document.querySelector('#lamp-health').classList.contains('warning-lit')"), true);
  await screenshot("health-warning.png");
  await click('[data-resource="hp"][data-delta="-1"]');
  assert.equal(await evaluate("document.querySelectorAll('.hp-segment.damaged').length"), 8);
  await click('[data-resource="hp"][data-delta="1"]');
  await click('[data-resource="hp"][data-delta="1"]');
  checks.push("Lost HP fills red cells from bottom to top: half HP = 5 red, one quarter = 8");
  await dragDial("vitality", 5);
  assert.equal(await evaluate("document.querySelector('#hp-readout').textContent"), "03 / 10");
  assert.equal(await evaluate("document.querySelector('#pilot-health-warning').classList.contains('is-critical')"), false);
  await click('[data-resource="hp"][data-delta="-1"]');
  assert.equal(await evaluate("document.querySelector('#pilot-health-warning').classList.contains('is-critical')"), true);
  await click('[data-resource="hp"][data-delta="1"]');
  assert.equal(await evaluate("document.querySelector('#pilot-health-warning').classList.contains('is-critical')"), false);
  checks.push("The large central red pilot lamp switches on at exactly 2 HP and below, and stays off at 3 HP even with a 10 HP maximum");
  await click('[data-resource="luck"][data-delta="-1"]');
  assert.equal(await evaluate("document.querySelector('#luck-readout').textContent"), "04 / 05");
  await dragDial("luck", 2);
  assert.equal(await evaluate("document.querySelector('#luck-readout').textContent"), "02 / 02");
  checks.push("HP = vitality × 2 and luck maximum = luck; spent resources stay spent and clamp to the new maximum");

  await evaluate("document.querySelector('[data-stat=mobility]').focus()");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Home", code: "Home" });
  assert.equal(await evaluate("document.querySelector('[data-stat=mobility]').getAttribute('aria-valuenow')"), "1");
  checks.push("Keyboard slider controls and limits work");

  const statsBeforeFlight = (await storedState()).stats;
  const initialPanorama = await evaluate("document.querySelector('#panorama-scroll').getAttribute('transform')");
  assert.equal(await evaluate("document.querySelector('#flight-heading').value"), "000° · С");
  const airframeMatrix = await evaluate("(() => { const matrix = document.querySelector('#airframe').getScreenCTM(); return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]; })()");
  const stickPoints = await evaluate("(() => { const matrix = document.querySelector('#control-stick').getScreenCTM(); const start = new DOMPoint(0, -95).matrixTransform(matrix); const end = new DOMPoint(70, -155).matrixTransform(matrix); return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } }; })()");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...stickPoints.start });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, ...stickPoints.end });
  await delay(500);
  assert.equal(await evaluate("Math.abs(Number(document.querySelector('#flight-world').getAttribute('transform').match(/rotate\\(([-\\d.]+)/)[1])) <= 9"), true);
  assert.notEqual(await evaluate("document.querySelector('#panorama-scroll').getAttribute('transform')"), initialPanorama);
  assert.deepEqual(await evaluate("(() => { const matrix = document.querySelector('#airframe').getScreenCTM(); return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]; })()"), airframeMatrix);
  await screenshot("banked-flight.png");
  let previousCourse = 0;
  let accumulatedTurn = 0;
  for (let sample = 0; sample < 30 && accumulatedTurn <= 360; sample += 1) {
    await delay(500);
    const currentCourse = await evaluate("Number(document.querySelector('#flight-world').dataset.heading)");
    accumulatedTurn += ((currentCourse - previousCourse + 540) % 360) - 180;
    previousCourse = currentCourse;
    if (sample === 1) await screenshot("turning-flight.png");
  }
  assert.equal(accumulatedTurn > 360, true);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...stickPoints.end });
  const stoppedCourse = await evaluate("document.querySelector('#flight-world').dataset.heading");
  await delay(800);
  assert.equal(await evaluate("document.querySelector('#flight-world').dataset.heading"), stoppedCourse);
  assert.equal(await evaluate("document.querySelector('#flight-world').getAttribute('transform').includes('rotate(0.000')"), true);
  await click("#level-flight-button");
  await delay(1000);
  assert.equal(await evaluate("document.querySelector('#flight-world').getAttribute('transform')"), "translate(0 0.000) rotate(0.000 800 180)");
  assert.equal(await evaluate("document.querySelector('#flight-world').dataset.heading"), stoppedCourse);
  assert.equal(await evaluate("document.querySelector('#course-readout').textContent === document.querySelector('#flight-heading').value.split(' · ')[0]"), true);
  assert.deepEqual((await storedState()).stats, statsBeforeFlight);
  assert.equal(await evaluate("document.querySelectorAll('#sky-cities use').length > 0 && document.querySelectorAll('#passing-aircraft use').length > 0"), true);
  checks.push("Holding the stick turns the heading horizontally through 360°, shifts the painted world around a circular panorama and limits bank to 9°; releasing and leveling preserve the selected course and stats");

  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await click("#dice-button");
  assert.equal(await evaluate("document.querySelector('#dice-dialog').open"), true);
  assert.equal(await evaluate("document.querySelectorAll('input[name=dice-count]').length"), 5);
  await click('input[name="dice-count"][value="5"]');
  assert.equal(await evaluate("document.querySelectorAll('#dice-tray .die').length"), 5);
  await evaluate("window.originalDiceRandom = window.crypto.getRandomValues.bind(window.crypto); window.diceSamples = [0, 1, 2, 3, 9]; window.crypto.getRandomValues = sample => { sample[0] = window.diceSamples.shift() ?? 9; return sample; };");
  await click("#roll-button");
  await delay(120);
  assert.equal(await evaluate("document.querySelector('#roll-button').disabled"), true);
  assert.equal(await evaluate("document.querySelectorAll('input[name=dice-count]:disabled').length"), 5);
  assert.equal(await evaluate("document.querySelectorAll('#dice-tray .rolling').length > 0"), true);
  await screenshot("dice-animation.png");
  await delay(1600);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('#dice-tray .die-number')].map(element => Number(element.textContent))"), [1, 2, 3, 4, 10]);
  assert.equal(await evaluate("document.querySelector('#dice-total').value"), "20");
  assert.equal(await evaluate("document.querySelector('#roll-button').disabled"), false);
  await screenshot("dice-results.png");
  await click('input[name="dice-count"][value="1"]');
  await click("#roll-button");
  await delay(90);
  await click("#dice-dialog .close-button");
  await click("#dice-button");
  assert.equal(await evaluate("document.querySelector('#dice-total').value"), "10");
  assert.equal(await evaluate("document.querySelector('#roll-button').disabled"), false);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  for (const count of [2, 3, 4]) {
    await click(`input[name="dice-count"][value="${count}"]`);
    await click("#roll-button");
    await delay(180);
    assert.equal(await evaluate("document.querySelectorAll('#dice-tray .die').length"), count);
    assert.equal(await evaluate("Number(document.querySelector('#dice-total').value)"), count * 10);
  }
  await click('input[name="dice-count"][value="5"]');
  assert.equal(await evaluate("document.querySelectorAll('#dice-history-list li').length"), 5);
  await evaluate("window.crypto.getRandomValues = window.originalDiceRandom; delete window.originalDiceRandom; delete window.diceSamples;");
  await send("Emulation.setEmulatedMedia", { features: [] });
  await click("#dice-dialog .close-button");
  checks.push("Animated 1–5 D10 rolls show values 1–10 and the exact sum; repeated clicks are blocked, closing mid-roll keeps the result, reduced motion works and five rolls remain in history");

  await click("#book-button");
  assert.equal(await evaluate("document.querySelector('#logbook').open"), true);
  await click("#pilot-name");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await send("Input.insertText", { text: "Лётчик / Сокол" });
  assert.equal(await evaluate("document.querySelector('#callsign-plate').textContent"), "ЛЁТЧИК / СОКОЛ");
  assert.equal((await storedState()).name, "Лётчик / Сокол");
  await screenshot("logbook.png");
  await click(".close-button");
  await send("Page.reload");
  await waitForPage();
  assert.equal(await evaluate("document.querySelector('#callsign-plate').textContent"), "ЛЁТЧИК / СОКОЛ");
  assert.equal(await evaluate("document.querySelector('#hp-readout').textContent"), "03 / 10");
  assert.equal((await storedState()).skills[0].name, "Пилотирование");
  assert.equal((await storedState()).skills[0].value, 5);
  assert.equal((await storedState()).skills[9].name, "Первая помощь");
  assert.equal((await storedState()).aircraft.speed, 6);
  assert.equal((await storedState()).aircraft.slots[9].name, "Световые ловушки");
  assert.equal((await storedState()).aircraft.afterburners, 99);
  assert.equal((await storedState()).aircraft.afterburnerCapacity, 125);
  assert.equal((await storedState()).aircraft.nodes.engine.current, 6);
  assert.equal((await storedState()).aircraft.nodes.wings.armor, 2);
  assert.equal((await storedState()).aircraft.nodes.wings.maximum, 10);
  assert.equal((await storedState()).skills.length, 25);
  assert.deepEqual((await storedState()).skills[24], { name: "Высший пилотаж", value: 5 });
  assert.equal((await storedState()).aircraft.slots.length, 10);
  assert.equal((await storedState()).aircraft.slots[8].name, "");
  checks.push("Added skill rows, even blank equipment rows, individual STR maxima, armor and three-digit afterburner values survive reloading");
  assert.equal(await evaluate("document.querySelector('#aircraft-slots-readout').textContent"), "05 / 10");
  assert.equal(await evaluate("document.querySelector('input[name=dice-count]:checked').value"), "5");
  checks.push("Pilot editing, drawer, Cyrillic, callsign plate and all saved values survive reload");

  await click("#callsign-button");
  assert.equal(await evaluate("document.querySelector('#identity-dialog').open"), true);
  await typeText("#callsign-input", "Анна Воронова / Ворон");
  await click("#identity-cancel");
  assert.equal((await storedState()).name, "Лётчик / Сокол");
  await click("#callsign-button");
  await typeText("#callsign-input", "Анна Воронова / Ворон");
  await click(".identity-save");
  assert.equal((await storedState()).name, "Анна Воронова / Ворон");
  assert.equal(await evaluate("document.querySelector('#pilot-name').value"), "Анна Воронова / Ворон");
  assert.equal(await evaluate("document.querySelector('#callsign-plate').textContent"), "АННА ВОРОНОВА / ВОРОН");
  assert.equal(await evaluate("document.querySelector('#callsign-button').closest('[aria-hidden=true]') === null"), true);
  checks.push("The central nameplate opens an accessible editor; cancel preserves the name and save synchronizes the plate, logbook and browser storage");

  await click("#aircraft-panel");
  await typeText("#aircraft-slot-capacity", "14");
  for (let count = 11; count <= 14; count += 1) {
    await click("#add-aircraft-slot");
    assert.equal(await evaluate("document.querySelectorAll('.aircraft-slot').length"), count);
  }
  await typeText("#aircraft-slot-name-13", "Люм-генератор");
  assert.equal(await evaluate("document.querySelector('#add-aircraft-slot').disabled"), true);
  assert.equal((await storedState()).aircraft.slotCapacity, 14);
  await typeText("#aircraft-slot-capacity", "2");
  assert.equal(await evaluate("document.querySelector('#aircraft-slot-warning').hidden"), false);
  assert.equal(await evaluate("document.querySelector('#add-aircraft-slot').disabled"), true);
  assert.equal((await storedState()).aircraft.slots[13].name, "Люм-генератор");
  await click("#aircraft-dialog .close-button");
  await send("Page.reload");
  await waitForPage();
  assert.equal((await storedState()).aircraft.slotCapacity, 2);
  assert.equal((await storedState()).aircraft.slots.length, 14);
  assert.equal((await storedState()).aircraft.slots[13].name, "Люм-генератор");
  await click("#aircraft-panel");
  await typeText("#aircraft-slot-capacity", "15");
  await click("#add-aircraft-slot");
  assert.equal((await storedState()).aircraft.slots.length, 15);
  await click("#aircraft-dialog .close-button");
  checks.push("The editable aircraft slot capacity supports more than ten slots, enforces the chosen limit, and preserves all added rows and equipment when lowered and reloaded");

  await evaluate("state = { version: 1, name: 'Ворон', biography: '', notes: '', stats: Object.fromEntries(STATS.map(stat => [stat.key, stat.initial])), skills: createSkills(), aircraft: createAircraft(), hp: 8, luck: 1, selected: 'mobility', lighting: false }; renderAll(); saveNow();");
  await send("Page.reload");
  await waitForPage();
  await evaluate("document.querySelectorAll('.instrument').forEach(element => element.blur())");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  assert.equal(await evaluate("document.querySelector('#monitor-overview').getAttribute('display')"), "inline");
  const monitorHover = await dialPoint("mobility", 0);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...monitorHover });
  assert.equal(await evaluate("document.querySelector('#monitor-detail').getAttribute('display')"), "inline");
  assert.equal(await evaluate("document.querySelector('#monitor-stat').textContent"), "ПОДВИЖНОСТЬ");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  assert.equal(await evaluate("document.querySelector('#monitor-overview').getAttribute('display')"), "inline");
  for (const key of ["wings", "engine", "fuel", "weapons", "cockpit"]) {
    const selector = `#annunciators [data-structure-node="${key}"]`;
    const condition = () => evaluate(`document.querySelector('[data-schematic-node="${key}"]').dataset.condition`);
    assert.equal(await condition(), "intact");
    await click(selector);
    assert.equal(await condition(), "damaged");
    for (let step = 0; step < 6; step += 1) await click(selector);
    assert.equal(await condition(), "critical");
    await click(selector);
    assert.equal(await condition(), "critical");
    await click(selector);
    assert.equal(await condition(), "intact");
  }
  await click('#annunciators [data-structure-node="wings"]');
  for (let step = 0; step < 7; step += 1) await click('#annunciators [data-structure-node="engine"]');
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await screenshot("damage-schematic.png");
  for (let step = 0; step < 8; step += 1) await click('#annunciators [data-structure-node="wings"]');
  await click('#annunciators [data-structure-node="engine"]');
  await click('#annunciators [data-structure-node="engine"]');
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  checks.push("The idle monitor shows the top-down aircraft; hovering a gauge temporarily shows its stat, and each of the five synchronized nodes turns green, yellow, then red at 1 STR and remains red at zero");
  await click("#rules-pocket");
  assert.equal(await evaluate("document.querySelector('#rules-dialog').open"), true);
  assert.equal(await evaluate("document.querySelectorAll('#rules-dialog tbody tr').length"), 5);
  assert.equal(await evaluate("document.querySelector('#rules-dialog').textContent.includes('Лимит зависит от типа самолёта')"), true);
  await screenshot("rules-manual.png");
  await click("#rules-dialog .close-button");
  checks.push("The leather pocket opens the readable flight manual with lore, resource rules and all five D10 hit locations");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  assert.equal(await evaluate("document.querySelector('#outside').contains(document.querySelector('#main-propeller')) && !document.querySelector('#flight-world').contains(document.querySelector('#main-propeller'))"), true);
  assert.equal(await evaluate("Boolean(document.querySelector('#main-propeller').compareDocumentPosition(document.querySelector('#upper-console')) & Node.DOCUMENT_POSITION_FOLLOWING)"), true);
  assert.equal(await evaluate("document.querySelectorAll('.main-propeller-rotor use').length"), 3);
  assert.equal(await evaluate("document.querySelector('.main-propeller-rotor').getAnimations().some(animation => animation.playState === 'running')"), true);
  const rotorTransform = await evaluate("getComputedStyle(document.querySelector('.main-propeller-rotor')).transform");
  await delay(75);
  assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.main-propeller-rotor')).transform"), rotorTransform);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#main-propeller')).pointerEvents"), "none");
  checks.push("The three-blade propeller actually rotates behind the nose and cockpit structure, stays independent of the moving world and does not block controls");
  assert.equal(await evaluate("document.querySelectorAll('#iron-sight circle').length >= 3"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#iron-sight')).pointerEvents"), "none");
  assert.equal(await evaluate("document.body.classList.contains('painted-world-ready')"), true);
  const artworkAtZero = await evaluate("document.querySelector('#panorama-scroll').getAttribute('transform')");
  await click("#control-stick");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight" });
  await evaluate("new Promise(resolve => { function check() { const heading = Number(document.querySelector('#flight-world').dataset.heading); if (heading >= 45 && heading < 70) resolve(heading); else requestAnimationFrame(check); } check(); })");
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight" });
  await delay(400);
  assert.equal(await evaluate("Number(document.querySelector('#sun-glare').dataset.intensity) > .65"), true);
  assert.notEqual(await evaluate("document.querySelector('#panorama-scroll').getAttribute('transform')"), artworkAtZero);
  await screenshot("sun-glare.png");
  await click("#lighting-button");
  assert.equal(await evaluate("document.querySelector('#sun-glare').getAttribute('opacity')"), "0");
  await click("#lighting-button");
  assert.equal(await evaluate("Number(document.querySelector('#sun-glare').dataset.intensity) > .65"), true);
  await click("#control-stick");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight" });
  await evaluate("new Promise(resolve => { function check() { const heading = Number(document.querySelector('#flight-world').dataset.heading); if (heading >= 140 && heading < 170) resolve(heading); else requestAnimationFrame(check); } check(); })");
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight" });
  assert.equal(await evaluate("document.querySelector('#sun-glare').getAttribute('opacity')"), "0");
  await send("Page.reload");
  await waitForPage();
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  checks.push("The iron ring sight stays fixed; the local painted panorama rotates, and solar glare brightens when facing the sun, vanishes when looking away, and is disabled at night");
  await screenshot("desktop.png");

  const statsBeforeNight = (await storedState()).stats;
  const daytimeSky = await evaluate("getComputedStyle(document.querySelector('#sky stop:first-child')).stopColor");
  await click("#lighting-button");
  await delay(550);
  assert.equal(await evaluate("document.querySelector('#lighting-button').getAttribute('aria-checked')"), "true");
  assert.equal(await evaluate("document.querySelector('#cockpit').contains(document.querySelector('#lighting-button')) && !document.querySelector('#lighting-button').closest('[aria-hidden=true]')"), true);
  assert.equal(await evaluate("document.querySelector('#lighting-rotor').getAttribute('transform')"), "rotate(45)");
  assert.equal(await evaluate("document.querySelector('#night-sky') === null"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#cockpit')).filter"), "none");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#flight-world')).filter"), "none");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#airframe')).filter.includes('brightness')"), true);
  assert.notEqual(await evaluate("getComputedStyle(document.querySelector('#sky stop:first-child')).stopColor"), daytimeSky);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#night-celestials')).opacity"), "1");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.dial-scale')).filter.includes('phosphor-glow')"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.monitor-value')).filter.includes('phosphor-glow')"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.resource-value')).filter.includes('phosphor-glow')"), true);
  await dragDial("mobility", 4);
  await dragDial("mobility", 3);
  for (let step = 0; step < 6; step += 1) await click('[data-resource="hp"][data-delta="-1"]');
  assert.equal(await evaluate("document.querySelectorAll('.hp-segment.damaged').length"), 8);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#lamp-health')).filter.includes('239, 53, 44')"), true);
  await screenshot("night-warning.png");
  for (let step = 0; step < 6; step += 1) await click('[data-resource="hp"][data-delta="1"]');
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await screenshot("night.png");
  assert.deepEqual((await storedState()).stats, statsBeforeNight);
  await send("Page.reload");
  await waitForPage();
  assert.equal(await evaluate("document.body.classList.contains('night')"), true);
  assert.equal(await evaluate("document.querySelector('#lighting-button').getAttribute('aria-checked')"), "true");
  await click("#lighting-button");
  await delay(550);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#airframe')).filter"), "none");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#sky stop:first-child')).stopColor"), daytimeSky);
  checks.push("Night lighting changes the sky, clouds and cockpit materials without an overlay; gauges and displays glow, controls work, and the mode survives reload and restores cleanly to daylight");

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(150);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  await screenshot("mobile.png");
  await click("#aircraft-panel");
  assert.equal(await evaluate("document.querySelector('#aircraft-dialog').open"), true);
  assert.equal(await evaluate("document.querySelector('#aircraft-dialog').scrollWidth <= document.querySelector('#aircraft-dialog').clientWidth"), true);
  await screenshot("mobile-aircraft.png");
  await click("#aircraft-dialog .close-button");
  await click("#rules-pocket");
  assert.equal(await evaluate("document.querySelector('#rules-dialog').open"), true);
  assert.equal(await evaluate("document.querySelector('#rules-dialog').scrollWidth <= document.querySelector('#rules-dialog').clientWidth"), true);
  await screenshot("mobile-rules.png");
  await click("#rules-dialog .close-button");
  await click("#callsign-button");
  assert.equal(await evaluate("document.querySelector('#identity-dialog').open"), true);
  assert.equal(await evaluate("document.querySelector('#identity-dialog').scrollWidth <= document.querySelector('#identity-dialog').clientWidth"), true);
  await click("#identity-cancel");
  await click("#lighting-button");
  await delay(550);
  await screenshot("mobile-night.png");
  await click("#lighting-button");
  await delay(550);
  await click("#skills-expand");
  assert.equal(await evaluate("document.querySelector('#skills-dialog').open"), true);
  assert.equal(await evaluate("document.querySelectorAll('#skills-dialog .skill-row').length"), 10);
  await screenshot("mobile-skills.png");
  await click("#skills-dialog .close-button");
  await click("#dice-button");
  assert.equal(await evaluate("document.querySelector('#dice-dialog').scrollWidth <= document.querySelector('#dice-dialog').clientWidth"), true);
  await screenshot("mobile-dice.png");
  await click("#dice-dialog .close-button");
  await click("#book-button");
  assert.equal(await evaluate("document.querySelector('#logbook').open"), true);
  await screenshot("mobile-logbook.png");
  checks.push("390px mobile layout has no horizontal overflow; logbook remains usable");
  await send("Page.navigate", { url: "file:///D:/site/index.html" });
  await waitForPage();
  assert.equal(await evaluate("document.querySelector('#points-counter').textContent"), "24 / 24");
  assert.equal(await evaluate("document.body.classList.contains('painted-world-ready')"), true);
  checks.push("Local file opening works offline with no server and no external assets");
  assert.deepEqual(errors, []);
  checks.push("No JavaScript or SVG rendering errors");
  const report = { status: "passed", checks, browser: "Chrome headless, native CDP, temporary profile; no Playwright", screenshots: ["desktop.png", "night.png", "logbook.png", "mobile.png", "mobile-night.png", "mobile-logbook.png", "banked-flight.png", "turning-flight.png", "health-warning.png", "skills-tablet.png", "mobile-skills.png", "dice-animation.png", "dice-results.png", "mobile-dice.png", "aircraft-passport.png", "mobile-aircraft.png", "rules-manual.png", "mobile-rules.png", "sun-glare.png", "damage-schematic.png"] };
  await writeFile(path.join(outputDirectory, "review.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (connection?.readyState === WebSocket.OPEN) await screenshot("review-failure.png").catch(() => {});
  throw error;
} finally {
  if (connection?.readyState === WebSocket.OPEN) {
    await send("Browser.close").catch(() => {});
    connection.close();
  }
  browser.kill();
  await delay(700);
  const resolvedProfile = path.resolve(profile);
  if (resolvedProfile.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolvedProfile).startsWith("skyphantoms-review-")) await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
