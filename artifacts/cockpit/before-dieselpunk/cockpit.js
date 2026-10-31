"use strict";

const STORAGE_KEY = "skyphantoms-cockpit-v1";
const SKILL_COUNT = 10;
const SKILL_ROW_LIMIT = 25;
const SKILL_MAXIMUM = 5;
const AIRCRAFT_SLOT_COUNT = 10;
const AFTERBURNER_MAXIMUM = 999;
const AIRCRAFT_FIELDS = [
  { key: "speed", label: "Скорость", initial: 3 },
  { key: "maneuverability", label: "Манёвренность", initial: 4 },
  { key: "armor", label: "Броня", initial: 0 }
];
const AIRCRAFT_NODES = [
  { key: "wings", label: "Оперение / Крылья", short: "КРЫЛЬЯ", hit: "1–3", warning: "Манёвренность −1", failure: "Штопор" },
  { key: "engine", label: "Двигатель / Мотор", short: "ДВИГАТЕЛЬ", hit: "4", warning: "Скорость −1", failure: "Заглох" },
  { key: "fuel", label: "Топливная система", short: "ТОПЛИВО", hit: "5", warning: "Утечка хода", failure: "Утечка" },
  { key: "weapons", label: "Вооружение / Пушки", short: "ОРУЖИЕ", hit: "6–8", warning: "Урон −2", failure: "Разбит" },
  { key: "cockpit", label: "Кабина / Управление", short: "УПРАВЛЕНИЕ", hit: "9–10", warning: "Внимательность −2", failure: "Критично" }
];
const STATS = [
  { key: "mobility", name: "Подвижность", instrument: "Скорость", type: "speed", unit: "км/ч ×100", code: "УС–450", initial: 3, x: 449, y: 524, radius: 79 },
  { key: "reaction", name: "Реакция", instrument: "Вариометр", type: "climb", unit: "м/с", code: "ВР–10", initial: 5, x: 606, y: 583, radius: 76 },
  { key: "awareness", name: "Внимательность", instrument: "Курсовой прибор", type: "heading", unit: "КУРС", code: "ГМК–1", initial: 2, x: 598, y: 409, radius: 77 },
  { key: "composure", name: "Стойкость", instrument: "Авиагоризонт", type: "attitude", unit: "КРЕН", code: "АГИ–1", initial: 4, x: 1000, y: 445, radius: 77 },
  { key: "athleticism", name: "Атлетизм", instrument: "Тахометр", type: "rpm", unit: "об/мин ×1000", code: "ИТЭ–1", initial: 4, x: 796, y: 654, radius: 80 },
  { key: "charisma", name: "Харизма", instrument: "Радиосвязь", type: "radio", unit: "МГц", code: "УКВ–52", initial: 1, x: 1144, y: 515, radius: 61 },
  { key: "vitality", name: "Жизненность", instrument: "Давление масла", type: "pressure", unit: "кгс/см²", code: "ЭМИ–3", initial: 4, x: 979, y: 649, radius: 78 },
  { key: "luck", name: "Удача", instrument: "Высотомер", type: "altitude", unit: "м ×1000", code: "ВД–10", initial: 1, x: 450, y: 697, radius: 76 }
];

const logbook = document.querySelector("#logbook");
const dialElements = new Map();
const fieldElements = new Map();
const skillElements = [];
const aircraftSlotElements = [];
const aircraftNodeElements = new Map();
const afterburnerReels = [];
let renderedAfterburners = null;
let activeDrag = null;
let saveTimer;
let storageAvailable = true;

function boundedInteger(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
}

function readStored(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function createSkills(source) {
  const length = Array.isArray(source) ? Math.min(SKILL_ROW_LIMIT, Math.max(SKILL_COUNT, source.length)) : SKILL_COUNT;
  return Array.from({ length }, (entry, index) => {
    const skill = Array.isArray(source) ? source[index] : undefined;
    return {
      name: typeof skill?.name === "string" ? skill.name.slice(0, 80) : "",
      value: boundedInteger(skill?.value ?? 0, 0, SKILL_MAXIMUM)
    };
  });
}

function createAircraft(source) {
  const examples = [
    { name: "Носовая пушка", effect: "Урон 2" },
    { name: "Форсаж", effect: "2 раза" },
    { name: "Дымовая завеса", effect: "" }
  ];
  const slots = Array.isArray(source?.slots) ? source.slots : examples;
  const technicalLimit = boundedInteger(source?.technicalLimit ?? 5, 0, 7, 5);
  const maximumStructure = technicalLimit + 3;
  const populatedSlotCount = Math.min(AIRCRAFT_SLOT_COUNT, slots.reduce((count, slot, index) => [slot?.name, slot?.effect].some(value => typeof value === "string" && value.trim()) ? index + 1 : count, 0));
  const slotCount = Math.max(populatedSlotCount, boundedInteger(source?.slotCount ?? populatedSlotCount, 0, AIRCRAFT_SLOT_COUNT));
  const afterburnerSlot = slots.find(slot => /форсаж/i.test(slot?.name || ""));
  const afterburnerEffect = typeof afterburnerSlot?.effect === "string" ? afterburnerSlot.effect : "";
  const initialCapacity = Number.parseInt(afterburnerEffect.match(/\d+/)?.[0] || "2", 10);
  const afterburnerCapacity = boundedInteger(source?.afterburnerCapacity ?? initialCapacity, 0, AFTERBURNER_MAXIMUM, 2);
  return {
    ...Object.fromEntries(AIRCRAFT_FIELDS.map(field => [field.key, boundedInteger(source?.[field.key] ?? field.initial, 0, 99, field.initial)])),
    technicalLimit,
    afterburnerCapacity,
    afterburners: boundedInteger(source?.afterburners ?? afterburnerCapacity, 0, afterburnerCapacity, afterburnerCapacity),
    nodes: Object.fromEntries(AIRCRAFT_NODES.map(node => {
      const maximum = boundedInteger(source?.nodes?.[node.key]?.maximum ?? maximumStructure, 1, 10, maximumStructure);
      return [node.key, {
        maximum,
        current: boundedInteger(source?.nodes?.[node.key]?.current ?? maximum, 0, maximum, maximum),
        armor: boundedInteger(source?.nodes?.[node.key]?.armor ?? source?.armor ?? 0, 0, 99)
      }];
    })),
    slotCount,
    slots: Array.from({ length: slotCount }, (entry, index) => ({
      name: typeof slots[index]?.name === "string" ? slots[index].name.slice(0, 80) : "",
      effect: typeof slots[index]?.effect === "string" ? slots[index].effect.slice(0, 80) : ""
    }))
  };
}

function loadState() {
  const current = readStored(STORAGE_KEY);
  const legacy = readStored("skyphantoms-logbook") || {};
  const source = current?.stats || legacy;
  const stats = Object.fromEntries(STATS.map(stat => {
    const stored = Number(source[stat.key]);
    return [stat.key, Number.isFinite(stored) && stored >= 1 && stored <= 5 ? Math.round(stored) : stat.initial];
  }));
  const hpMaximum = stats.vitality * 2;
  const luckMaximum = stats.luck;
  const legacyHp = typeof legacy.hp === "string" ? Number.parseInt(legacy.hp, 10) : undefined;
  const legacyLuck = typeof legacy["luck-points"] === "string" ? Number.parseInt(legacy["luck-points"], 10) : undefined;
  const selected = STATS.some(stat => stat.key === current?.selected) ? current.selected : "mobility";
  return {
    version: 1,
    name: typeof current?.name === "string" ? current.name : String(legacy.callsign || "Коул Кросс / Спичка"),
    biography: typeof current?.biography === "string" ? current.biography : String(legacy.faction || legacy.bio || ""),
    notes: typeof current?.notes === "string" ? current.notes : String(legacy.notes || ""),
    stats,
    skills: createSkills(current?.skills),
    aircraft: createAircraft(current?.aircraft),
    hp: boundedInteger(current?.hp ?? legacyHp ?? hpMaximum, 0, hpMaximum, hpMaximum),
    luck: boundedInteger(current?.luck ?? legacyLuck ?? luckMaximum, 0, luckMaximum, luckMaximum),
    selected,
    lighting: current?.lighting === true
  };
}

let state = loadState();

function pointOnDial(angle, radius) {
  const radians = angle * Math.PI / 180;
  return { x: Math.sin(radians) * radius, y: -Math.cos(radians) * radius };
}

function angleForValue(value) {
  return -135 + (value - 1) * 67.5;
}

function arcPath(radius, start, end) {
  const first = pointOnDial(start, radius);
  const last = pointOnDial(end, radius);
  return `M${first.x} ${first.y}A${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${last.x} ${last.y}`;
}

function screwMarkup(positionX, positionY, small = false) {
  return `<use href="#${small ? "small-screw" : "screw"}" x="${positionX}" y="${positionY}"/>`;
}

function decorativeGauge({ x: positionX = 0, y: positionY = 0, radius, caption, angle = 20, compass = false, clock = false }) {
  let marks = "";
  const count = clock || compass ? 60 : 40;
  for (let index = 0; index < count; index += 1) {
    const degree = clock || compass ? index * 360 / count : -135 + index * 270 / (count - 1);
    const major = index % 5 === 0;
    const outer = pointOnDial(degree, radius * .78);
    const inner = pointOnDial(degree, radius * (major ? .65 : .73));
    marks += `<path class="dial-tick" d="M${inner.x} ${inner.y}L${outer.x} ${outer.y}" stroke="#d2d4b6" stroke-width="${major ? 2 : .9}"/>`;
    if (major) {
      const label = pointOnDial(degree, radius * .52);
      const text = clock ? String(index / 5 || 12) : compass ? ["С", "", "В", "", "Ю", "", "З", ""][Math.round(index / 5 / 1.5)] || "" : String(index / 5);
      marks += `<text class="dial-scale" x="${label.x}" y="${label.y}" font-size="${radius * .18}">${text}</text>`;
    }
  }
  const pointer = pointOnDial(angle, radius * .69);
  const secondPointer = pointOnDial(angle + 133, radius * .47);
  return `<g transform="translate(${positionX} ${positionY})"><circle class="instrument-mount" r="${radius + 4}" fill="#203539" stroke="#91a38f" stroke-width="1"/><circle class="instrument-bezel" r="${radius}" fill="url(#bezel)"/><circle r="${radius * .84}" fill="url(#dial-face)"/>${marks}<text y="${radius * .29}" class="dial-caption" font-size="${radius * .115}">${caption}</text><path class="aux-needle" d="M0 10L${pointer.x} ${pointer.y}" stroke="#e2e1bd" stroke-width="2.8" stroke-linecap="round"/>${clock ? `<path class="aux-needle" d="M0 0L${secondPointer.x} ${secondPointer.y}" stroke="#e2e1bd" stroke-width="3.8"/>` : ""}<circle r="4" fill="#bfb88c"/><circle r="${radius * .84}" fill="url(#dial-glass)"/></g>`;
}

function renderSceneryDetails() {
  document.querySelector("#decorative-gauges").innerHTML = [
    decorativeGauge({ x: 607, y: 781, radius: 68, caption: "КИ–13", angle: 13, compass: true }),
    decorativeGauge({ x: 852, y: 800, radius: 50, caption: "ВОЗДУХ", angle: -40 }),
    decorativeGauge({ x: 1000, y: 799, radius: 52, caption: "ТОПЛИВО", angle: 48 })
  ].join("");

  const screws = [[377, 440], [1221, 440], [371, 806], [1224, 806], [679, 340], [923, 340], [345, 887], [1255, 887], [404, 920], [1196, 920], [1322, 540], [274, 548], [154, 705], [1446, 705], [125, 935], [1475, 935]];
  document.querySelector("#panel-screws").innerHTML = screws.map(([positionX, positionY]) => screwMarkup(positionX, positionY)).join("");
  const canopyBolts = [[278, 64], [230, 191], [181, 319], [132, 446], [84, 576], [1322, 64], [1370, 191], [1419, 319], [1468, 446], [1516, 576]];
  document.querySelector("#canopy-bolts").innerHTML = canopyBolts.map(([positionX, positionY]) => screwMarkup(positionX, positionY)).join("");

  document.querySelector("#annunciators").innerHTML = AIRCRAFT_NODES.map((node, index) => {
    const positionX = 699 + index % 3 * 79;
    const positionY = 182 + Math.floor(index / 3) * 44;
    return `<g class="structure-button" data-structure-node="${node.key}" tabindex="0" role="button"><rect x="${positionX}" y="${positionY}" width="74" height="42" rx="3" fill="#0a171b" stroke="#55635a"/><rect class="node-lamp" id="node-${node.key}-lamp" x="${positionX + 3}" y="${positionY + 3}" width="68" height="36" rx="2" fill="#365548"/><text x="${positionX + 37}" y="${positionY + 12}" text-anchor="middle" class="structure-node-title">${node.short}</text><text id="node-${node.key}-readout" x="${positionX + 37}" y="${positionY + 25}" text-anchor="middle" class="structure-node-value">8 / 8</text><g id="node-${node.key}-cells" transform="translate(${positionX + 7} ${positionY + 29})"></g><g id="node-${node.key}-armor-cells" transform="translate(${positionX + 7} ${positionY + 35})"></g><title>${node.label}</title></g>`;
  }).join("") + '<g><rect x="857" y="226" width="74" height="40" rx="3" fill="#0a171b" stroke="#55635a"/><rect id="lamp-ready" x="860" y="229" width="68" height="34" rx="2" fill="#365548"/><text id="points-label" x="894" y="238" text-anchor="middle" class="structure-node-title">ОЧКИ ПИЛОТА</text><text id="points-counter" x="894" y="255" text-anchor="middle" class="annunciator-points">24 / 24</text></g>';

  const wear = [
    "M360 882h51l12 7-27-1-7 4-30-2Z", "M480 894h93l9 6-41 1-19-4-42 3Z", "M1101 891h48l9-4 40 3-12 4-35-1-28 4Z",
    "M1382 558l19 26-2 15-10-12-11-6Z", "M1343 697l25 2 4 9-19-2-7 6-5-3Z", "M326 486l-5 22-8 4 5-20Z", "M175 703l18-9 6 4-21 12Z",
    "M975 864h67l10 4-22 3-10-3-45 1Z", "M1468 842l8 19-4 13-6-11Z", "M141 922h33l4 6-32-2-8 2Z"
  ];
  let seed = 52;
  function nextRandom() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  let scratches = "";
  for (let index = 0; index < 155; index += 1) {
    const positionX = 100 + nextRandom() * 1400;
    const positionY = 308 + nextRandom() * 680;
    const width = 1 + nextRandom() * 8;
    scratches += `<path d="M${positionX.toFixed(1)} ${positionY.toFixed(1)}l${width.toFixed(1)} ${(-nextRandom() * 2).toFixed(1)}" stroke="${index % 3 ? "#c8c8aa" : "#102d34"}" stroke-width="${index % 5 ? .6 : 1.4}" opacity="${index % 4 ? .14 : .35}"/>`;
  }
  document.querySelector("#paint-wear").innerHTML = wear.map(path => `<path d="${path}" fill="#bebfa4" opacity=".45"/>`).join("") + scratches;
}

function instrumentBackground(stat) {
  const radius = stat.radius;
  if (stat.type === "attitude") {
    const size = radius * .43;
    return `<defs><clipPath id="horizon-clip"><circle cy="-5" r="${size}"/></clipPath></defs><g clip-path="url(#horizon-clip)"><g class="horizon-card"><rect class="horizon-sky" x="-${size * 2}" y="-${size * 2}" width="${size * 4}" height="${size * 2 - 5}" fill="#4c777d"/><rect class="horizon-ground" x="-${size * 2}" y="-5" width="${size * 4}" height="${size * 2}" fill="#71684e"/><path d="M-${size * 2}-5h${size * 4}" stroke="#d2cf99" stroke-width="1.5"/><path d="M-13-17h26m-8-8h16M-13 7h26" stroke="#c7cfa6" stroke-width="1"/></g></g><path d="M-${size - 3}-3h17l5 5h10l5-5h17M0-9v7" fill="none" stroke="#e1c476" stroke-width="2.4"/>`;
  }
  if (stat.type === "heading") {
    let card = `<circle r="${radius * .43}" fill="none" stroke="#707c60" stroke-width=".7"/>`;
    ["С", "В", "Ю", "З"].forEach((label, index) => {
      const point = pointOnDial(index * 90, radius * .37);
      card += `<text x="${point.x}" y="${point.y + 3}" text-anchor="middle" fill="#b8c59a" font-family="Consolas,monospace" font-size="8">${label}</text>`;
    });
    return `<g class="compass-card">${card}<path d="M0-22 4-5 20 0 4 5 0 22-4 5-20 0-4-5Z" fill="#999c69" fill-opacity=".3" stroke="#b5b774" stroke-width=".8"/></g>`;
  }
  if (stat.type === "rpm" || stat.type === "pressure" || stat.type === "speed") {
    return `<path d="${arcPath(radius * .83, -65, 67)}" fill="none" stroke="#76916c" stroke-width="3.5" opacity=".8"/><path d="${arcPath(radius * .83, 70, 106)}" fill="none" stroke="#d4b866" stroke-width="3.5"/><path d="${arcPath(radius * .83, 109, 135)}" fill="none" stroke="#c86145" stroke-width="3.5"/>`;
  }
  if (stat.type === "radio") {
    return `<path d="M-18-10q18-18 36 0m-28 4q10-10 20 0m-13 2 3 3 3-3" fill="none" stroke="#8eaa87" stroke-width="1.5"/>`;
  }
  if (stat.type === "altitude") {
    return `<path d="M-12 1H12M0-10v23" stroke="#859679" stroke-width=".8"/><circle r="${radius * .42}" fill="none" stroke="#849078" stroke-width=".7" stroke-dasharray="1 8"/>`;
  }
  return `<path d="M-20-15h13M-20-6h9M-20 3h13M-20 12h9" stroke="#b6bca1" stroke-width="1"/><text x="17" y="-5" text-anchor="middle" font-size="8" fill="#bec4a4" font-family="Consolas,monospace">+</text>`;
}

function instrumentMarkup(stat) {
  const radius = stat.radius;
  let marks = "";
  for (let index = 0; index <= 40; index += 1) {
    const angle = -135 + index * 6.75;
    const major = index % 10 === 0;
    const medium = index % 5 === 0;
    const outer = pointOnDial(angle, radius * .78);
    const inner = pointOnDial(angle, radius * (major ? .66 : medium ? .7 : .735));
    marks += `<path class="dial-tick" d="M${inner.x} ${inner.y}L${outer.x} ${outer.y}" stroke="#dddec0" stroke-width="${major ? 2.3 : medium ? 1.4 : .8}"/>`;
    if (major) {
      const point = pointOnDial(angle, radius * .565);
      marks += `<text class="dial-scale" x="${point.x}" y="${point.y}" font-size="${radius * .18}">${1 + index / 10}</text>`;
    }
  }
  const length = radius * .79;
  const fontSize = radius * (stat.name.length > 12 ? .105 : .118);
  const labelWidth = radius * 1.45;
  const unitY = stat.type === "attitude" || stat.type === "heading" ? -radius * .55 : -radius * .23;
  return `<g class="instrument" data-stat="${stat.key}" transform="translate(${stat.x} ${stat.y})" role="slider" tabindex="0" aria-label="${stat.name} — ${stat.instrument}" aria-valuemin="1" aria-valuemax="5" aria-valuenow="${state.stats[stat.key]}" aria-orientation="horizontal"><title>${stat.name} — ${stat.instrument}. Потяните стрелку, нажмите на шкалу или используйте клавиши со стрелками.</title><rect class="instrument-mount" x="-${radius * .93}" y="-${radius * .93}" width="${radius * 1.86}" height="${radius * 1.86}" rx="${radius * .22}" fill="#233536" stroke="#789183" stroke-width="1" filter="url(#shadow)"/>${[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([horizontal, vertical]) => screwMarkup(horizontal * radius * .8, vertical * radius * .8, true)).join("")}<circle class="instrument-bezel" r="${radius}" fill="url(#bezel)"/><circle r="${radius * .84}" fill="url(#dial-face)" stroke="#0b181a" stroke-width="2"/>${instrumentBackground(stat)}${marks}<text class="dial-unit" y="${unitY}" font-size="${radius * .085}">${stat.unit}</text><text class="dial-caption" y="${radius * .34}" font-size="${fontSize}" textLength="${Math.min(labelWidth, stat.name.length * fontSize * .65)}" lengthAdjust="spacingAndGlyphs">${stat.name.toUpperCase()}</text><rect x="-${radius * .185}" y="${radius * .46}" width="${radius * .37}" height="${radius * .24}" rx="1" fill="#0b1518" stroke="#576653" stroke-width=".8"/><text class="dial-value" y="${radius * .65}" font-size="${radius * .23}">${state.stats[stat.key]}</text><text class="dial-unit" y="${radius * .8}" font-size="${radius * .075}">${stat.code}</text><g class="dial-needle" transform="rotate(${angleForValue(state.stats[stat.key])})"><path class="needle-main" d="M-2.3 15V-${length - 8}L0-${length}l2.3 8V15Z"/><path class="needle-tip" d="M-2.1-${length - 15} 0-${length}l2.1 15Z"/><path d="M-3.5 7h7v13h-7Z" fill="#b9b58e"/></g><circle r="6" fill="url(#steel)" stroke="#101f22" stroke-width="2"/><circle r="2.3" fill="#b8bf9d"/><circle class="dial-glass" r="${radius * .84}" fill="url(#dial-glass)"/><circle class="focus-ring" r="${radius + 4}"/><circle class="dial-touch" r="${radius}"/></g>`;
}

function renderFields() {
  document.querySelector("#stat-fields").innerHTML = STATS.map(stat => `<div class="stat-field"><label for="field-${stat.key}">${stat.name}<small>${stat.instrument}</small></label><div class="stat-stepper"><button type="button" data-step="-1" data-key="${stat.key}" aria-label="Уменьшить: ${stat.name}">−</button><input id="field-${stat.key}" type="number" min="1" max="5" step="1" value="${state.stats[stat.key]}"><button type="button" data-step="1" data-key="${stat.key}" aria-label="Увеличить: ${stat.name}">+</button></div></div>`).join("");
  STATS.forEach(stat => {
    const input = document.querySelector(`#field-${stat.key}`);
    fieldElements.set(stat.key, input);
    input.addEventListener("input", () => {
      if (input.value !== "") setStat(stat, input.value);
    });
    input.addEventListener("change", () => setStat(stat, input.value));
  });
  document.querySelectorAll("[data-step]").forEach(button => button.addEventListener("click", () => {
    const stat = STATS.find(item => item.key === button.dataset.key);
    setStat(stat, state.stats[stat.key] + Number(button.dataset.step));
  }));
}

function renderSkill(index) {
  const skill = state.skills[index];
  const elements = skillElements[index];
  if (elements.name.value !== skill.name) elements.name.value = skill.name;
  elements.range.value = skill.value;
  elements.range.style.setProperty("--skill-progress", `${skill.value / SKILL_MAXIMUM * 100}%`);
  elements.range.setAttribute("aria-label", skill.name.trim() ? `Бонус навыка: ${skill.name}` : `Бонус навыка ${index + 1}`);
  elements.output.value = skill.value === 0 ? "0" : `+${skill.value}`;
}

function initializeSkills() {
  document.querySelector("#skills-list").replaceChildren();
  skillElements.length = 0;
  state.skills.forEach((skill, index) => appendSkillRow(index));
  renderSkillCount();
}

function appendSkillRow(index) {
  document.querySelector("#skills-list").insertAdjacentHTML("beforeend", `<div class="skill-row" data-skill-index="${index}"><div class="skill-name-line"><label class="skill-index" for="skill-name-${index}">${String(index + 1).padStart(2, "0")}</label><input class="skill-name" id="skill-name-${index}" type="text" maxlength="80" autocomplete="off" placeholder="Название навыка" aria-label="Название навыка ${index + 1}"></div><div class="skill-level-line"><input class="skill-level" id="skill-level-${index}" type="range" min="0" max="${SKILL_MAXIMUM}" step="1" value="0" aria-label="Бонус навыка ${index + 1}"><output class="skill-value" id="skill-value-${index}" for="skill-level-${index}">0</output></div></div>`);
  const elements = {
    name: document.querySelector(`#skill-name-${index}`),
    range: document.querySelector(`#skill-level-${index}`),
    output: document.querySelector(`#skill-value-${index}`)
  };
  skillElements.push(elements);
  elements.name.addEventListener("input", () => {
    state.skills[index].name = elements.name.value;
    renderSkill(index);
    queueSave();
  });
  elements.range.addEventListener("input", () => {
    state.skills[index].value = boundedInteger(elements.range.value, 0, SKILL_MAXIMUM);
    renderSkill(index);
    queueSave();
  });
  renderSkill(index);
}

function renderSkillCount() {
  const full = state.skills.length >= SKILL_ROW_LIMIT;
  document.querySelector("#skill-count").value = `${state.skills.length} / ${SKILL_ROW_LIMIT}`;
  const button = document.querySelector("#add-skill");
  button.disabled = full;
  button.title = full ? "Добавлено 25 навыков" : "Добавить один навык";
}

function initializeAircraftSlots() {
  document.querySelector("#aircraft-slots").replaceChildren();
  aircraftSlotElements.length = 0;
  state.aircraft.slots.forEach((slot, index) => appendAircraftSlot(index));
}

function appendAircraftSlot(index) {
  document.querySelector("#aircraft-slots").insertAdjacentHTML("beforeend", `<div class="aircraft-slot" data-aircraft-slot="${index}"><span class="aircraft-slot-number">${String(index + 1).padStart(2, "0")}</span><input id="aircraft-slot-name-${index}" type="text" maxlength="80" autocomplete="off" placeholder="Пустой слот" aria-label="Оборудование в слоте ${index + 1}"><input id="aircraft-slot-effect-${index}" type="text" maxlength="80" autocomplete="off" placeholder="Эффект / число" aria-label="Эффект оборудования в слоте ${index + 1}"></div>`);
  const elements = {
    row: document.querySelector(`[data-aircraft-slot="${index}"]`),
    name: document.querySelector(`#aircraft-slot-name-${index}`),
    effect: document.querySelector(`#aircraft-slot-effect-${index}`)
  };
  aircraftSlotElements.push(elements);
  ["name", "effect"].forEach(key => elements[key].addEventListener("input", () => {
    state.aircraft.slots[index][key] = elements[key].value;
    renderAircraft();
    queueSave();
  }));
}

function initializeAircraft() {
  initializeAircraftSlots();
  AIRCRAFT_FIELDS.forEach(field => {
    const input = document.querySelector(`#aircraft-${field.key}`);
    function update() {
      const previous = state.aircraft[field.key];
      state.aircraft[field.key] = boundedInteger(input.value, 0, 99, state.aircraft[field.key]);
      if (field.key === "armor") Object.values(state.aircraft.nodes).forEach(node => { if (node.armor === previous) node.armor = state.aircraft.armor; });
      renderAircraft();
      queueSave();
    }
    input.addEventListener("input", () => { if (input.value !== "") update(); });
    input.addEventListener("change", update);
  });
  initializeAircraftSystems();
  const dialog = document.querySelector("#aircraft-dialog");
  const panel = document.querySelector("#aircraft-panel");
  panel.addEventListener("click", () => dialog.showModal());
  panel.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dialog.showModal();
    }
  });
  dialog.addEventListener("click", event => {
    if (event.target === dialog && event.clientX < dialog.getBoundingClientRect().left) dialog.close();
  });
}

function renderAircraft() {
  if (aircraftSlotElements.length !== state.aircraft.slots.length) initializeAircraftSlots();
  AIRCRAFT_FIELDS.forEach(field => {
    const value = state.aircraft[field.key];
    document.querySelector(`#aircraft-${field.key}-readout`).textContent = value;
    const input = document.querySelector(`#aircraft-${field.key}`);
    if (input.value !== String(value)) input.value = value;
  });
  let occupied = 0;
  state.aircraft.slots.forEach((slot, index) => {
    const elements = aircraftSlotElements[index];
    const filled = Boolean(slot.name.trim() || slot.effect.trim());
    if (filled) occupied += 1;
    elements.row.classList.toggle("filled", filled);
    ["name", "effect"].forEach(key => { if (elements[key].value !== slot[key]) elements[key].value = slot[key]; });
  });
  document.querySelector("#aircraft-slot-count").textContent = `Занято: ${occupied} / ${AIRCRAFT_SLOT_COUNT}`;
  const full = state.aircraft.slots.length >= AIRCRAFT_SLOT_COUNT;
  document.querySelector("#add-aircraft-slot").disabled = full;
  document.querySelector("#add-aircraft-slot").title = full ? "Добавлены все 10 слотов" : "Добавить один слот оборудования";
  document.querySelector("#aircraft-row-count").value = `${state.aircraft.slots.length} / ${AIRCRAFT_SLOT_COUNT}`;
  document.querySelector("#aircraft-slots-readout").textContent = `${String(occupied).padStart(2, "0")} / ${AIRCRAFT_SLOT_COUNT}`;
  document.querySelector("#aircraft-panel").setAttribute("aria-label", `Самолёт: скорость ${state.aircraft.speed}, манёвренность ${state.aircraft.maneuverability}, броня ${state.aircraft.armor}. Занято ${occupied} из ${AIRCRAFT_SLOT_COUNT} слотов. Нажмите для редактирования.`);
  renderAircraftSystems();
}

function cycleAircraftNode(key) {
  const node = state.aircraft.nodes[key];
  if (!node) return;
  node.current = node.current === 0 ? node.maximum : node.current - 1;
  renderAircraftSystems();
  queueSave();
}

function setNodeMaximum(node, maximum) {
  node.current = node.current === node.maximum ? maximum : Math.min(node.current, maximum);
  node.maximum = maximum;
}

function initializeAircraftSystems() {
  document.querySelector("#aircraft-structure").innerHTML = AIRCRAFT_NODES.map(node => `<div class="structure-row"><label class="structure-node-label" for="node-${node.key}-maximum">${node.label}<small>D10: ${node.hit}</small></label><input id="node-${node.key}-armor" class="structure-armor" type="number" min="0" max="99" aria-label="Броня узла: ${node.label}"><input id="node-${node.key}-maximum" class="structure-maximum" type="number" min="1" max="10" aria-label="Максимум STR узла: ${node.label}"><div><button class="node-damage-button" type="button" data-structure-node="${node.key}"><output class="node-damage-value">8 / 8</output><span class="node-damage-cells"></span><span class="node-armor-cells" hidden></span></button><span class="structure-status"></span></div></div>`).join("");
  AIRCRAFT_NODES.forEach(node => {
    const armor = document.querySelector(`#node-${node.key}-armor`);
    const row = armor.closest(".structure-row");
    const maximum = document.querySelector(`#node-${node.key}-maximum`);
    aircraftNodeElements.set(node.key, { row, armor, maximum, button: row.querySelector(".node-damage-button"), value: row.querySelector(".node-damage-value"), cells: row.querySelector(".node-damage-cells"), armorCells: row.querySelector(".node-armor-cells"), status: row.querySelector(".structure-status") });
    function updateArmor() {
      state.aircraft.nodes[node.key].armor = boundedInteger(armor.value, 0, 99, state.aircraft.nodes[node.key].armor);
      renderAircraftSystems();
      queueSave();
    }
    armor.addEventListener("input", () => { if (armor.value !== "") updateArmor(); });
    armor.addEventListener("change", updateArmor);
    function updateMaximum() {
      const condition = state.aircraft.nodes[node.key];
      setNodeMaximum(condition, boundedInteger(maximum.value, 1, 10, condition.maximum));
      renderAircraftSystems();
      queueSave();
    }
    maximum.addEventListener("input", () => { if (maximum.value !== "") updateMaximum(); });
    maximum.addEventListener("change", updateMaximum);
  });
  function activateNode(event) {
    const button = event.target.closest("[data-structure-node]");
    if (button) cycleAircraftNode(button.dataset.structureNode);
  }
  document.querySelector("#aircraft-structure").addEventListener("click", activateNode);
  document.querySelector("#annunciators").addEventListener("click", activateNode);
  document.querySelector("#annunciators").addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!event.repeat) activateNode(event);
    }
  });
  const technicalInput = document.querySelector("#aircraft-technical-limit");
  function updateTechnicalLimit() {
    const previousMaximum = state.aircraft.technicalLimit + 3;
    state.aircraft.technicalLimit = boundedInteger(technicalInput.value, 0, 7, state.aircraft.technicalLimit);
    const maximum = state.aircraft.technicalLimit + 3;
    Object.values(state.aircraft.nodes).forEach(node => { if (node.maximum === previousMaximum) setNodeMaximum(node, maximum); });
    renderAircraftSystems();
    queueSave();
  }
  technicalInput.addEventListener("input", () => { if (technicalInput.value !== "") updateTechnicalLimit(); });
  technicalInput.addEventListener("change", updateTechnicalLimit);
  const capacityInput = document.querySelector("#aircraft-afterburner-capacity");
  function updateCapacity() {
    const previous = state.aircraft.afterburnerCapacity;
    state.aircraft.afterburnerCapacity = boundedInteger(capacityInput.value, 0, AFTERBURNER_MAXIMUM, previous);
    state.aircraft.afterburners = state.aircraft.afterburners === previous ? state.aircraft.afterburnerCapacity : Math.min(state.aircraft.afterburners, state.aircraft.afterburnerCapacity);
    renderAircraftSystems();
    queueSave();
  }
  capacityInput.addEventListener("input", () => { if (capacityInput.value !== "") updateCapacity(); });
  capacityInput.addEventListener("change", updateCapacity);
  const remainingInput = document.querySelector("#aircraft-afterburners");
  function updateRemaining() {
    state.aircraft.afterburners = boundedInteger(remainingInput.value, 0, state.aircraft.afterburnerCapacity, state.aircraft.afterburners);
    renderAircraftSystems();
    queueSave();
  }
  remainingInput.addEventListener("input", () => { if (remainingInput.value !== "") updateRemaining(); });
  remainingInput.addEventListener("change", updateRemaining);
  initializeAfterburnerCounter();
}

function initializeAfterburnerCounter() {
  ["hundreds", "tens", "units"].forEach((place, index) => {
    const element = document.querySelector(`#afterburner-${place}`);
    element.innerHTML = Array.from({ length: 30 }, (entry, digit) => `<text class="odometer-digit" x="${(index - 1) * 25}" y="${digit * 34 + 9}" text-anchor="middle">${digit % 10}</text>`).join("");
    afterburnerReels.push({ element, index: null, animation: null });
  });
  function bindButton(selector, action) {
    const button = document.querySelector(selector);
    button.addEventListener("click", action);
    button.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!event.repeat) action();
      }
    });
  }
  bindButton("#afterburner-spend", () => {
    if (state.aircraft.afterburners === 0) return;
    state.aircraft.afterburners -= 1;
    renderAircraftSystems();
    queueSave();
  });
  bindButton("#afterburner-refill", () => {
    state.aircraft.afterburners = state.aircraft.afterburnerCapacity;
    renderAircraftSystems();
    queueSave();
  });
}

function renderAfterburnerCounter() {
  const value = state.aircraft.afterburners;
  const digits = String(value).padStart(3, "0");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (value !== renderedAfterburners) afterburnerReels.forEach((reel, place) => {
    const digit = Number(digits[place]);
    if (reel.index === null) {
      reel.index = 10 + digit;
      reel.element.style.transform = `translateY(${-reel.index * 34}px)`;
      return;
    }
    const currentTransform = getComputedStyle(reel.element).transform;
    let startOffset = currentTransform === "none" ? -reel.index * 34 : new DOMMatrix(currentTransform).m42;
    const previousDigit = reel.index % 10;
    if (reel.index < 10 || reel.index > 19) {
      const normalizedIndex = 10 + previousDigit;
      startOffset -= (normalizedIndex - reel.index) * 34;
      reel.index = normalizedIndex;
    }
    const difference = value < renderedAfterburners ? -((previousDigit - digit + 10) % 10) : (digit - previousDigit + 10) % 10;
    reel.index += difference;
    reel.animation?.cancel();
    const target = `translateY(${-reel.index * 34}px)`;
    reel.element.style.transform = target;
    if (!reducedMotion && difference !== 0 && typeof reel.element.animate === "function") reel.animation = reel.element.animate([{ transform: `translateY(${startOffset}px)` }, { transform: target }], { duration: 440, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
  renderedAfterburners = value;
  document.querySelector("#afterburner-counter").dataset.value = String(value);
  document.querySelector("#afterburner-capacity-label").textContent = `ИЗ ${String(state.aircraft.afterburnerCapacity).padStart(3, "0")}`;
  const spend = document.querySelector("#afterburner-spend");
  spend.setAttribute("aria-disabled", String(value === 0));
  spend.setAttribute("aria-label", `Форсажей осталось ${value} из ${state.aircraft.afterburnerCapacity}. Нажмите, чтобы потратить один.`);
}

function renderAircraftSystems() {
  const maximum = state.aircraft.technicalLimit + 3;
  document.querySelector("#structure-maximum").textContent = `БАЗОВЫЙ STR: ${maximum}`;
  document.querySelector("#aircraft-technical-limit").value = state.aircraft.technicalLimit;
  document.querySelector("#aircraft-afterburner-capacity").value = state.aircraft.afterburnerCapacity;
  document.querySelector("#aircraft-afterburners").value = state.aircraft.afterburners;
  document.querySelector("#aircraft-afterburners").max = state.aircraft.afterburnerCapacity;
  AIRCRAFT_NODES.forEach(node => {
    const condition = state.aircraft.nodes[node.key];
    const maximum = condition.maximum;
    const elements = aircraftNodeElements.get(node.key);
    const low = condition.current > 0 && condition.current <= 2;
    const destroyed = condition.current === 0;
    const status = destroyed ? node.failure : low ? node.warning : "Цел";
    const description = `${node.label}, D10 ${node.hit}. STR ${condition.current} из ${maximum}, броня ${condition.armor}. ${status}. ${destroyed ? "Следующий клик восстановит узел." : "Нажатие снимает один STR."}`;
    const button = document.querySelector(`#annunciators [data-structure-node="${node.key}"]`);
    button.setAttribute("aria-label", description);
    button.querySelector("title").textContent = description;
    button.classList.toggle("structure-low", low);
    button.classList.toggle("structure-critical", destroyed);
    const lamp = document.querySelector(`#node-${node.key}-lamp`);
    lamp.setAttribute("fill", destroyed ? "#8c3028" : low ? "#9a6b2e" : "#365548");
    lamp.classList.toggle("warning-lit", low || destroyed);
    document.querySelector(`#node-${node.key}-readout`).textContent = `${condition.current} / ${maximum}`;
    let svgCells = "";
    let htmlCells = "";
    for (let index = 0; index < maximum; index += 1) {
      const damaged = index < maximum - condition.current;
      svgCells += `<rect class="structure-cell${damaged ? " damaged" : ""}" x="${index * 60 / maximum}" width="${60 / maximum - 1.5}" height="4" rx=".5" fill="${damaged ? "#df624c" : "#b9ce9a"}"/>`;
      htmlCells += `<span class="${damaged ? "damaged" : ""}"></span>`;
    }
    document.querySelector(`#node-${node.key}-cells`).innerHTML = svgCells;
    const armorSegments = Math.min(10, condition.armor);
    document.querySelector(`#node-${node.key}-armor-cells`).innerHTML = Array.from({ length: armorSegments }, (entry, index) => `<rect class="armor-cell" x="${index * 60 / armorSegments}" width="${60 / armorSegments - 1.5}" height="3" rx=".5" fill="#69a8d2"/>`).join("");
    elements.value.value = `${condition.current} / ${maximum}`;
    elements.cells.innerHTML = htmlCells;
    elements.cells.style.setProperty("--structure-cells", maximum);
    elements.armor.value = condition.armor;
    elements.maximum.value = maximum;
    elements.armorCells.hidden = armorSegments === 0;
    elements.armorCells.innerHTML = "<span></span>".repeat(armorSegments);
    elements.armorCells.style.setProperty("--armor-cells", armorSegments);
    elements.button.setAttribute("aria-label", description);
    elements.button.classList.toggle("structure-low", low);
    elements.button.classList.toggle("structure-critical", destroyed);
    elements.status.textContent = status;
    elements.status.classList.toggle("structure-status-warning", low || destroyed);
  });
  renderAfterburnerCounter();
}

function selectStat(stat) {
  state.selected = stat.key;
  document.querySelector("#monitor-stat").textContent = stat.name.toUpperCase();
  document.querySelector("#monitor-value").textContent = String(state.stats[stat.key]).padStart(2, "0");
  document.querySelector("#monitor-instrument").textContent = stat.instrument.toUpperCase();
  const label = document.querySelector("#selected-stat");
  label.replaceChildren(document.createTextNode(`${stat.name} `));
  const subtitle = document.createElement("span");
  subtitle.textContent = `· ${stat.instrument}`;
  label.append(subtitle);
}

function renderStat(stat, previewAngle) {
  const value = state.stats[stat.key];
  const dial = dialElements.get(stat.key);
  const angle = previewAngle ?? angleForValue(value);
  dial.querySelector(".dial-needle").setAttribute("transform", `rotate(${angle})`);
  dial.querySelector(".dial-value").textContent = value;
  dial.setAttribute("aria-valuenow", value);
  dial.setAttribute("aria-valuetext", `${stat.name}: ${value} из 5`);
  const horizon = dial.querySelector(".horizon-card");
  if (horizon) horizon.setAttribute("transform", `rotate(${angle * -.18} 0 -5)`);
  const card = dial.querySelector(".compass-card");
  if (card) card.setAttribute("transform", `rotate(${-angle * .35})`);
  const input = fieldElements.get(stat.key);
  if (input) input.value = value;
  document.querySelectorAll(`[data-step][data-key="${stat.key}"]`).forEach(button => {
    button.disabled = Number(button.dataset.step) > 0 ? value >= 5 : value <= 1;
  });
}

function renderResources() {
  const hpMaximum = state.stats.vitality * 2;
  const luckMaximum = state.stats.luck;
  document.querySelector("#hp-readout").textContent = `${String(state.hp).padStart(2, "0")} / ${String(hpMaximum).padStart(2, "0")}`;
  document.querySelector("#luck-readout").textContent = `${String(state.luck).padStart(2, "0")} / ${String(luckMaximum).padStart(2, "0")}`;
  document.querySelector("#hp-max").value = hpMaximum;
  document.querySelector("#luck-max").value = luckMaximum;
  const hpInput = document.querySelector("#hp-current");
  const luckInput = document.querySelector("#luck-current");
  hpInput.max = hpMaximum;
  luckInput.max = luckMaximum;
  hpInput.value = state.hp;
  luckInput.value = state.luck;
  const damagedSegments = Math.round((1 - state.hp / hpMaximum) * 10);
  let segments = "";
  for (let index = 0; index < 10; index += 1) {
    const positionY = 754 - index * 14;
    const damaged = index < damagedSegments;
    segments += `<rect class="hp-segment${damaged ? " damaged" : ""}" x="1128" y="${positionY}" width="24" height="9" rx="1" fill="${damaged ? "#dd624b" : "#a3b99c"}" stroke="${damaged ? "#ed9a71" : "#779084"}" stroke-width=".4"/><text x="1170" y="${positionY + 8}" class="stencil" font-size="8">${index + 1}</text><path d="M1183 ${positionY + 4}h9" stroke="#b2bca2" stroke-width=".8"/>`;
  }
  document.querySelector("#hp-segments").innerHTML = segments;
  const healthWarning = state.hp <= 2;
  const healthLamp = document.querySelector("#lamp-health");
  healthLamp.classList.toggle("warning-lit", healthWarning);
  const warning = document.querySelector("#pilot-health-warning");
  warning.classList.toggle("is-critical", healthWarning);
  warning.setAttribute("aria-label", healthWarning ? `Критическое здоровье пилота: осталось ${state.hp} HP` : `Здоровье пилота в норме: ${state.hp} HP`);
}

function renderAllocation() {
  const total = Object.values(state.stats).reduce((sum, value) => sum + value, 0);
  const counter = document.querySelector("#points-counter");
  counter.textContent = `${total} / 24`;
  counter.classList.toggle("over-budget", total !== 24);
  const allocation = document.querySelector("#allocation-status");
  allocation.textContent = `${total} / 24 очка`;
  allocation.classList.toggle("invalid", total !== 24);
  document.querySelector("#lamp-ready").setAttribute("fill", total === 24 ? "#4e8c64" : "#b08039");
}

function setStat(stat, rawValue, previewAngle) {
  const oldValue = state.stats[stat.key];
  const value = boundedInteger(rawValue, 1, 5, oldValue);
  state.stats[stat.key] = value;
  if (stat.key === "vitality") state.hp = state.hp === oldValue * 2 ? value * 2 : Math.min(state.hp, value * 2);
  if (stat.key === "luck") state.luck = state.luck === oldValue ? value : Math.min(state.luck, value);
  renderStat(stat, previewAngle);
  selectStat(stat);
  if (value !== oldValue) {
    renderResources();
    renderAllocation();
    queueSave();
  }
}

function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  const label = storageAvailable ? "Бортовой журнал сохранён" : "Сохранение недоступно в этом браузере";
  const status = document.querySelector("#save-status");
  status.replaceChildren();
  const dot = document.createElement("span");
  dot.className = "live-dot";
  status.append(dot, document.createTextNode(label));
  document.querySelector("#book-save-status").textContent = storageAvailable ? "Сохранено на этом устройстве" : "Изменения сохранятся только до закрытия";
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 180);
}

function pointerAngle(event, dial) {
  const matrix = dial.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  if (Math.hypot(point.x, point.y) < 9) return null;
  let angle = Math.atan2(point.x, -point.y) * 180 / Math.PI;
  if (activeDrag?.angle > 90 && angle < -135) angle = 135;
  if (activeDrag?.angle < -90 && angle > 135) angle = -135;
  return Math.max(-135, Math.min(135, angle));
}

function bindDial(stat, dial) {
  dial.addEventListener("pointerenter", () => { if (!activeDrag) selectStat(stat); });
  dial.addEventListener("focus", () => selectStat(stat));
  dial.addEventListener("pointerdown", event => {
    if (event.button !== 0 || activeDrag) return;
    event.preventDefault();
    dial.focus({ preventScroll: true });
    dial.setPointerCapture(event.pointerId);
    activeDrag = { stat, dial, pointerId: event.pointerId, angle: angleForValue(state.stats[stat.key]) };
    dial.classList.add("dragging");
    const angle = pointerAngle(event, dial);
    if (angle !== null) {
      activeDrag.angle = angle;
      setStat(stat, 1 + (angle + 135) / 67.5, angle);
    }
  });
  dial.addEventListener("pointermove", event => {
    if (!activeDrag || activeDrag.dial !== dial || activeDrag.pointerId !== event.pointerId) return;
    const angle = pointerAngle(event, dial);
    if (angle !== null) {
      activeDrag.angle = angle;
      setStat(stat, 1 + (angle + 135) / 67.5, angle);
    }
  });
  function finishDrag(event) {
    if (!activeDrag || activeDrag.dial !== dial || activeDrag.pointerId !== event.pointerId) return;
    dial.classList.remove("dragging");
    activeDrag = null;
    renderStat(stat);
    saveNow();
  }
  dial.addEventListener("pointerup", finishDrag);
  dial.addEventListener("pointercancel", finishDrag);
  dial.addEventListener("lostpointercapture", finishDrag);
  dial.addEventListener("keydown", event => {
    const changes = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 1, PageDown: -1 };
    if (Object.hasOwn(changes, event.key)) {
      event.preventDefault();
      setStat(stat, state.stats[stat.key] + changes[event.key]);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setStat(stat, event.key === "Home" ? 1 : 5);
    }
  });
}

function setResource(resource, rawValue) {
  const maximum = resource === "hp" ? state.stats.vitality * 2 : state.stats.luck;
  state[resource] = boundedInteger(rawValue, 0, maximum, state[resource]);
  renderResources();
  queueSave();
}

function renderIdentity() {
  document.querySelector("#pilot-name").value = state.name;
  document.querySelector("#pilot-bio").value = state.biography;
  document.querySelector("#pilot-notes").value = state.notes;
  const callsign = state.name.split("/").at(-1).trim() || "ПИЛОТ";
  document.querySelector("#callsign-plate").textContent = `${callsign.slice(0, 10).toUpperCase()} · 052`;
}

function renderLighting() {
  document.body.classList.toggle("night", state.lighting);
  const button = document.querySelector("#lighting-button");
  button.setAttribute("aria-checked", String(state.lighting));
  const label = state.lighting ? "Вернуть дневной режим" : "Включить ночной режим";
  button.setAttribute("aria-label", label);
  button.querySelector("title").textContent = label;
  document.querySelector("#lighting-rotor").setAttribute("transform", `rotate(${state.lighting ? 45 : -45})`);
  document.querySelector("#lighting-readout").textContent = state.lighting ? "НОЧЬ" : "ДЕНЬ";
}

function createFlightPanorama() {
  const objects = [];
  const world = document.querySelector("#flight-world");
  const courseCard = document.querySelector("#course-card");
  const courseReadout = document.querySelector("#course-readout");
  const headingReadout = document.querySelector("#flight-heading");
  const seaPattern = document.querySelector("#sea-ripples");
  let previousHeading = null;

  function addObjects(selector, entries, markup) {
    const container = document.querySelector(selector);
    container.innerHTML = entries.map((entry, index) => `<g data-panorama-object="${index}" data-bearing="${entry.bearing}">${markup(entry, index)}</g>`).join("");
    [...container.children].forEach((element, index) => objects.push({ ...entries[index], element }));
  }

  let scenerySeed = 52617;
  function randomScenery() {
    scenerySeed = (scenerySeed * 1664525 + 1013904223) >>> 0;
    return scenerySeed / 4294967296;
  }
  const seaStrokes = [];
  for (let index = 0; index < 2100; index += 1) {
    const depth = Math.pow(randomScenery(), 1.7);
    const positionX = -1600 + randomScenery() * 4800;
    const positionY = 190 + depth * 1200;
    const length = (3 + randomScenery() * 31) * (.25 + depth * 2.7);
    const height = (.15 + depth * 1.6) * (randomScenery() - .5);
    const opacity = .04 + randomScenery() * .14;
    seaStrokes.push(`<path d="m${positionX.toFixed(1)} ${positionY.toFixed(1)}q${(length * .45).toFixed(1)} ${height.toFixed(1)} ${length.toFixed(1)} ${(-height).toFixed(1)}" stroke="${index % 5 === 0 ? "#d8d5bb" : index % 3 === 0 ? "#173e4f" : "#a7c3bd"}" stroke-width="${(.35 + depth * .9).toFixed(2)}" opacity="${opacity.toFixed(2)}"/>`);
  }
  document.querySelector("#sea-surface").innerHTML = seaStrokes.join("");

  addObjects("#sea-islands", [
    { bearing: -42, offset: 105, scale: .72, verticalScale: .7 },
    { bearing: 36, offset: 92, scale: .68, verticalScale: .7 },
    { bearing: 78, offset: 145, scale: .95, verticalScale: .6 },
    { bearing: 121, offset: 86, scale: .62, verticalScale: .72 },
    { bearing: 165, offset: 124, scale: .9, verticalScale: .64 },
    { bearing: 210, offset: 100, scale: .76, verticalScale: .7 },
    { bearing: 256, offset: 156, scale: 1.1, verticalScale: .62 },
    { bearing: 294, offset: 73, scale: .56, verticalScale: .72 }
  ], (entry, index) => `<g class="island-drift ${["island-east", "island-west", "island-south"][index % 3]}"><use href="#island-shape" transform="scale(${index % 2 ? -1 : 1} 1) rotate(${index % 2 ? 5 : -4})"/>${index % 3 === 0 ? '<use href="#island-shape" transform="translate(190 29) scale(.35 .6) rotate(-12)"/>' : ""}</g>`);

  addObjects("#panorama-clouds", Array.from({ length: 12 }, (entry, index) => ({
    bearing: index * 30 - 48,
    offset: -(55 + index * 29 % 105),
    scale: 1.1 + index % 3 * .4,
    verticalScale: .6,
    perspective: false
  })), (entry, index) => `<g class="cloud-layer" opacity="${index % 2 ? .38 : .65}"><g class="${index % 2 ? "cloud-far" : "cloud-near"}" filter="url(#cloud-softness)"><path d="M-138 18q19-12 34-9 11-18 30-12 8-28 32-26 24-22 48-2 22-9 41 11 30-3 42 17 31-2 54 18-36 6-67 3l-71 5-76-2Z" fill="url(#cloud-light)"/><path d="M-122 20q34-7 70-1 41-15 83-5 25-6 57 4l49 9-107 7-108-3Z" fill="#7e969e" opacity=".2"/><path d="M-69-1q14-17 34-12 17-23 38-8 10-8 23 0-28-2-40 6-23-5-55 14Z" fill="#f0ebdc" opacity=".3"/></g></g>`);

  addObjects("#passing-aircraft", [
    { bearing: -21, offset: -94, scale: .82, verticalScale: 1 },
    { bearing: 32, offset: -127, scale: .43, verticalScale: 1 },
    { bearing: 134, offset: -90, scale: .62, verticalScale: 1 },
    { bearing: 238, offset: -112, scale: .9, verticalScale: 1 }
  ], (entry, index) => `<g opacity="${index % 2 ? .65 : .92}"><g class="biplane-pass ${index % 2 ? "plane-far" : "plane-near"}"><use href="#biplane-shape"/></g></g>`);

  const stars = Array.from({ length: 60 }, (entry, index) => ({
    bearing: index * 6 + index * 7 % 5,
    offset: -(55 + index * 19 % 130),
    scale: 1,
    verticalScale: 1,
    perspective: false,
    radius: 1 + index % 3 * .35
  }));
  stars.push({ bearing: 28, offset: -130, scale: 1, verticalScale: 1, perspective: false, moon: true });
  addObjects("#night-celestials", stars, entry => entry.moon ? '<path d="M8-24a27 27 0 1 0 22 38A26 26 0 0 1 8-24Z" fill="#bdd7cb" opacity=".8"/>' : `<circle r="${entry.radius}" fill="#c0d6d6"/>`);

  return function renderHeading(heading) {
    const normalized = ((heading % 360) + 360) % 360;
    if (normalized === previousHeading) return;
    previousHeading = normalized;
    objects.forEach(object => {
      const relative = ((object.bearing - normalized + 540) % 360) - 180;
      const visible = Math.abs(relative) < 78;
      object.element.style.display = visible ? "" : "none";
      if (!visible) return;
      const radians = relative * Math.PI / 180;
      const cosine = Math.cos(radians);
      const positionX = 800 + Math.tan(radians) * 640;
      const positionY = 180 + object.offset / cosine;
      const scale = object.scale / (object.perspective === false ? 1 : cosine);
      object.element.setAttribute("transform", `translate(${positionX.toFixed(3)} ${positionY.toFixed(3)}) scale(${scale.toFixed(4)} ${(scale * object.verticalScale).toFixed(4)})`);
    });
    const degrees = String(Math.round(normalized) % 360).padStart(3, "0");
    const direction = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"][Math.round(normalized / 45) % 8];
    headingReadout.value = `${degrees}° · ${direction}`;
    courseReadout.textContent = `${degrees}°`;
    courseCard.setAttribute("transform", `rotate(${-normalized} 1018 217)`);
    seaPattern.setAttribute("patternTransform", `translate(${-normalized / 360 * 170} 0)`);
    world.dataset.heading = normalized.toFixed(3);
  };
}

function initializeFlightControl() {
  const stick = document.querySelector("#control-stick");
  const movingStick = document.querySelector("#stick-moving");
  const world = document.querySelector("#flight-world");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const renderHeading = createFlightPanorama();
  const control = { heading: 0, bank: 0, pitch: 0, turnInput: 0, pitchInput: 0, stickRoll: 0, stickPitch: 0, leveling: false, pointerId: null, origin: null, frame: 0, timestamp: 0 };
  const pressedKeys = new Set();

  function animate(timestamp) {
    const elapsed = control.timestamp ? Math.min(timestamp - control.timestamp, 60) : 16;
    control.timestamp = timestamp;
    const blend = reducedMotion.matches ? 1 : 1 - Math.exp(-elapsed / 95);
    control.heading += control.turnInput * elapsed * .06;
    control.bank += (control.turnInput * 9 - control.bank) * blend;
    if (Math.abs(control.bank - control.turnInput * 9) < .025) control.bank = control.turnInput * 9;
    if (control.leveling) {
      control.pitch += -control.pitch * blend;
      if (Math.abs(control.pitch) < .025) {
        control.pitch = 0;
        control.leveling = false;
      }
    } else {
      control.pitch = Math.max(-120, Math.min(120, control.pitch + control.pitchInput * elapsed * .09));
    }
    control.stickRoll += (control.turnInput * 18 - control.stickRoll) * blend;
    control.stickPitch += (control.pitchInput * 65 - control.stickPitch) * blend;
    const stickSettled = Math.abs(control.stickRoll - control.turnInput * 18) < .025 && Math.abs(control.stickPitch - control.pitchInput * 65) < .025;
    if (stickSettled) {
      control.stickRoll = control.turnInput * 18;
      control.stickPitch = control.pitchInput * 65;
    }
    const settled = control.turnInput === 0 && control.pitchInput === 0 && !control.leveling && stickSettled && control.bank === 0;
    world.setAttribute("transform", `translate(0 ${control.pitch.toFixed(3)}) rotate(${(-control.bank).toFixed(3)} 800 180)`);
    renderHeading(control.heading);
    movingStick.setAttribute("transform", `rotate(${control.stickRoll.toFixed(3)}) scale(1 ${(1 - control.stickPitch / 750).toFixed(4)})`);
    if (settled) {
      control.frame = 0;
      control.timestamp = 0;
    } else control.frame = requestAnimationFrame(animate);
  }

  function setInput(turn, pitch) {
    control.turnInput = Math.max(-1, Math.min(1, turn));
    control.pitchInput = Math.max(-1, Math.min(1, pitch));
    if (turn !== 0 || pitch !== 0) control.leveling = false;
    if (!control.frame) control.frame = requestAnimationFrame(animate);
  }

  function levelFlight() {
    release();
    control.leveling = true;
    if (!control.frame) control.frame = requestAnimationFrame(animate);
  }

  function localPoint(event) {
    const matrix = stick.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
  }

  function release(event) {
    if (event && control.pointerId !== event.pointerId) return;
    control.pointerId = null;
    control.origin = null;
    pressedKeys.clear();
    stick.classList.remove("dragging");
    setInput(0, 0);
  }

  stick.addEventListener("pointerdown", event => {
    if (event.button !== 0 || control.pointerId !== null) return;
    const origin = localPoint(event);
    if (!origin) return;
    event.preventDefault();
    stick.focus({ preventScroll: true });
    control.pointerId = event.pointerId;
    control.origin = origin;
    stick.setPointerCapture(event.pointerId);
    stick.classList.add("dragging");
  });
  stick.addEventListener("pointermove", event => {
    if (control.pointerId !== event.pointerId || !control.origin) return;
    const point = localPoint(event);
    if (point) setInput((point.x - control.origin.x) / 78, (point.y - control.origin.y) / 78);
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(type => stick.addEventListener(type, release));
  stick.addEventListener("blur", () => release());
  stick.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) return;
    event.preventDefault();
    if (event.key === " ") {
      levelFlight();
      return;
    }
    pressedKeys.add(event.key);
    setInput(Number(pressedKeys.has("ArrowRight")) - Number(pressedKeys.has("ArrowLeft")), Number(pressedKeys.has("ArrowDown")) - Number(pressedKeys.has("ArrowUp")));
  });
  stick.addEventListener("keyup", event => {
    if (!pressedKeys.delete(event.key)) return;
    event.preventDefault();
    setInput(Number(pressedKeys.has("ArrowRight")) - Number(pressedKeys.has("ArrowLeft")), Number(pressedKeys.has("ArrowDown")) - Number(pressedKeys.has("ArrowUp")));
  });
  stick.addEventListener("dblclick", levelFlight);
  document.querySelector("#level-flight-button").addEventListener("click", levelFlight);
  window.addEventListener("blur", () => release());
  renderHeading(0);
}

function renderAll() {
  STATS.forEach(stat => renderStat(stat));
  if (skillElements.length !== state.skills.length) initializeSkills();
  state.skills.forEach((skill, index) => renderSkill(index));
  renderSkillCount();
  renderIdentity();
  renderResources();
  renderAircraft();
  renderAllocation();
  renderLighting();
  selectStat(STATS.find(stat => stat.key === state.selected));
}

renderSceneryDetails();
document.querySelector("#flight-instruments").innerHTML = STATS.map(instrumentMarkup).join("");
STATS.forEach(stat => {
  const dial = document.querySelector(`[data-stat="${stat.key}"]`);
  dialElements.set(stat.key, dial);
  bindDial(stat, dial);
});
renderFields();
initializeSkills();
initializeAircraft();
renderAll();
initializeFlightControl();

document.querySelector("#add-skill").addEventListener("click", () => {
  if (state.skills.length >= SKILL_ROW_LIMIT) return;
  const index = state.skills.push({ name: "", value: 0 }) - 1;
  appendSkillRow(index);
  renderSkillCount();
  const list = document.querySelector("#skills-list");
  list.scrollTop = list.scrollHeight;
  queueSave();
});

document.querySelector("#add-aircraft-slot").addEventListener("click", () => {
  if (state.aircraft.slots.length >= AIRCRAFT_SLOT_COUNT) return;
  const index = state.aircraft.slots.push({ name: "", effect: "" }) - 1;
  state.aircraft.slotCount = state.aircraft.slots.length;
  appendAircraftSlot(index);
  renderAircraft();
  aircraftSlotElements[index].name.focus();
  queueSave();
});

const skillsDialog = document.querySelector("#skills-dialog");
const skillsPanel = document.querySelector(".skills-panel");
document.querySelector("#skills-expand").addEventListener("click", () => {
  document.querySelector("#skills-dialog-slot").append(skillsPanel);
  skillsDialog.showModal();
});
skillsDialog.addEventListener("close", () => document.querySelector("#kneeboard-mount").append(skillsPanel));
skillsDialog.addEventListener("click", event => {
  const rectangle = skillsDialog.getBoundingClientRect();
  if (event.target === skillsDialog && (event.clientX < rectangle.left || event.clientX > rectangle.right || event.clientY < rectangle.top || event.clientY > rectangle.bottom)) skillsDialog.close();
});

document.querySelector("#book-button").addEventListener("click", () => logbook.showModal());
logbook.addEventListener("click", event => {
  const rectangle = logbook.getBoundingClientRect();
  if (event.target === logbook && event.clientX < rectangle.left) logbook.close();
});
document.querySelector("#lighting-button").addEventListener("click", () => {
  state.lighting = !state.lighting;
  renderLighting();
  queueSave();
});
document.querySelector("#lighting-button").addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!event.repeat) document.querySelector("#lighting-button").dispatchEvent(new MouseEvent("click"));
  }
});
document.querySelector("#fullscreen-button").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    document.querySelector("#fullscreen-button").title = "Браузер не разрешил полноэкранный режим";
  }
});
document.addEventListener("fullscreenchange", () => {
  const button = document.querySelector("#fullscreen-button");
  const label = document.fullscreenElement ? "Выйти из полноэкранного режима" : "На весь экран";
  button.setAttribute("aria-label", label);
  button.title = label;
});
[["#pilot-name", "name"], ["#pilot-bio", "biography"], ["#pilot-notes", "notes"]].forEach(([selector, key]) => {
  document.querySelector(selector).addEventListener("input", event => {
    state[key] = event.target.value;
    if (key === "name") {
      const callsign = state.name.split("/").at(-1).trim() || "ПИЛОТ";
      document.querySelector("#callsign-plate").textContent = `${callsign.slice(0, 10).toUpperCase()} · 052`;
    }
    queueSave();
  });
});
document.querySelectorAll(".resource-button").forEach(button => {
  function activate() {
    setResource(button.dataset.resource, state[button.dataset.resource] + Number(button.dataset.delta));
  }
  button.addEventListener("click", activate);
  button.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
});
[["#hp-current", "hp"], ["#luck-current", "luck"]].forEach(([selector, resource]) => {
  const input = document.querySelector(selector);
  input.addEventListener("input", () => { if (input.value !== "") setResource(resource, input.value); });
  input.addEventListener("change", () => setResource(resource, input.value));
});
document.querySelector("#reset-button").addEventListener("click", () => {
  if (!window.confirm("Очистить имя, заметки, навыки и оборудование самолёта? Характеристики вернутся к значениям с листа персонажа.")) return;
  state = {
    version: 1, name: "", biography: "", notes: "",
    stats: Object.fromEntries(STATS.map(stat => [stat.key, stat.initial])),
    skills: createSkills(),
    aircraft: createAircraft({ slots: [], afterburnerCapacity: 0, afterburners: 0 }),
    hp: 8, luck: 1, selected: "mobility", lighting: false
  };
  renderAll();
  saveNow();
});
window.addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });
saveNow();
