(() => {
  "use strict";

  const preferenceKey = "skyphantoms-dice-count";
  const dialog = document.querySelector("#dice-dialog");
  const tray = document.querySelector("#dice-tray");
  const rollButton = document.querySelector("#roll-button");
  const countInputs = [...document.querySelectorAll('input[name="dice-count"]')];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const history = [];
  let count = 1;
  let activeRoll = null;

  try {
    const stored = Number(localStorage.getItem(preferenceKey));
    if (Number.isFinite(stored) && stored >= 1 && stored <= 5) count = Math.round(stored);
  } catch {}

  function rollD10() {
    if (!window.crypto?.getRandomValues) return Math.floor(Math.random() * 10) + 1;
    const sample = new Uint32Array(1);
    const limit = Math.floor(4294967296 / 10) * 10;
    do { window.crypto.getRandomValues(sample); } while (sample[0] >= limit);
    return sample[0] % 10 + 1;
  }

  function dieMarkup(index, value) {
    const angles = [-6, 5, -2, 7, -5];
    return `<div class="die" style="--rest-angle:${angles[index]}deg"><svg viewBox="0 0 120 124" aria-hidden="true"><defs><linearGradient id="die-light-${index}" x2="1" y2="1"><stop stop-color="#9fb3a0"/><stop offset="1" stop-color="#536f5b"/></linearGradient><linearGradient id="die-front-${index}" x2=".8" y2="1"><stop stop-color="#728e74"/><stop offset="1" stop-color="#294f3c"/></linearGradient></defs><path d="M60 5 108 34 99 86 60 115 21 86 12 34Z" fill="#3a5a48" stroke="#c4c49d" stroke-width="1.5"/><path d="M60 5 60 43 32 63 12 34Z" fill="#719076" stroke="#b2bd99" stroke-width="1"/><path d="M60 5 108 34 88 63 60 43Z" fill="url(#die-light-${index})" stroke="#b2bd99" stroke-width="1"/><path d="M108 34 99 86 60 115 88 63Z" fill="#2d4b40" stroke="#94a785" stroke-width="1"/><path d="M12 34 32 63 60 115 21 86Z" fill="#4d6b53" stroke="#94a785" stroke-width="1"/><path d="M60 43 88 63 60 115 32 63Z" fill="url(#die-front-${index})" stroke="#c0c5a1" stroke-width="1.1"/><path d="m60 8 43 27-15 26" fill="none" stroke="#f1ecd0" stroke-opacity=".35" stroke-width="1.2"/><text class="die-number" x="60" y="82">${value ?? "—"}</text></svg></div>`;
  }

  function renderDice(results = []) {
    tray.dataset.count = count;
    tray.innerHTML = Array.from({ length: count }, (entry, index) => dieMarkup(index, results[index])).join("");
  }

  function setBusy(busy) {
    rollButton.disabled = busy;
    countInputs.forEach(input => { input.disabled = busy; });
    document.querySelector("#dice-stage").setAttribute("aria-busy", String(busy));
    document.querySelector("#roll-button-label").textContent = busy ? "Кубики в воздухе…" : `Бросить ${count}D10`;
  }

  function renderHistory() {
    const list = document.querySelector("#dice-history-list");
    list.replaceChildren();
    history.forEach(result => {
      const row = document.createElement("li");
      const formula = document.createElement("span");
      formula.className = "history-formula";
      formula.textContent = `${result.values.length}D10`;
      const values = document.createElement("span");
      values.className = "history-values";
      values.textContent = result.values.join(" · ");
      const total = document.createElement("span");
      total.className = "history-total";
      total.textContent = result.total;
      row.append(formula, values, total);
      list.append(row);
    });
  }

  function settleRoll(roll) {
    if (activeRoll !== roll) return;
    activeRoll = null;
    clearInterval(roll.previewTimer);
    clearTimeout(roll.fallbackTimer);
    roll.animations.forEach(animation => animation.cancel());
    renderDice(roll.values);
    const total = roll.values.reduce((sum, value) => sum + value, 0);
    document.querySelector("#dice-result-label").textContent = `Результат ${count}D10`;
    document.querySelector("#dice-results").textContent = roll.values.join(" + ");
    document.querySelector("#dice-total").value = total;
    history.unshift({ values: [...roll.values], total });
    history.splice(5);
    renderHistory();
    setBusy(false);
  }

  function startRoll() {
    if (activeRoll) return;
    const roll = { values: Array.from({ length: count }, rollD10), animations: [], previewTimer: null, fallbackTimer: null };
    activeRoll = roll;
    renderDice();
    setBusy(true);
    document.querySelector("#dice-result-label").textContent = "Бросаем кубики…";
    document.querySelector("#dice-results").textContent = `${count}D10`;
    document.querySelector("#dice-total").value = "—";
    const dice = [...tray.querySelectorAll(".die")];

    if (reducedMotion.matches || typeof dice[0].animate !== "function") {
      roll.fallbackTimer = setTimeout(() => settleRoll(roll), 100);
      return;
    }

    dice.forEach((die, index) => {
      die.classList.add("rolling");
      const direction = index % 2 ? -1 : 1;
      const restingAngle = [-6, 5, -2, 7, -5][index];
      const animation = die.animate([
        { transform: `translate(${direction * 15}px, -55px) rotateX(45deg) rotateY(${direction * 35}deg) rotate(${direction * -130}deg) scale(.78)`, opacity: .3, offset: 0 },
        { transform: `translate(${direction * -12}px, 12px) rotateX(-30deg) rotateY(${direction * 130}deg) rotate(${direction * 70}deg) scale(1)`, opacity: 1, offset: .32 },
        { transform: `translate(${direction * 8}px, -23px) rotateX(25deg) rotateY(${direction * 250}deg) rotate(${direction * 210}deg) scale(.94)`, offset: .58 },
        { transform: `translate(0, 5px) rotateX(-8deg) rotateY(${direction * 340}deg) rotate(${direction * 345}deg) scale(1.03, .96)`, offset: .82 },
        { transform: `translate(0, -4px) rotateX(0deg) rotateY(${direction * 360}deg) rotate(${direction * 360 + restingAngle}deg) scale(1)`, offset: .93 },
        { transform: `translate(0, 0) rotateX(0deg) rotateY(${direction * 360}deg) rotate(${direction * 360 + restingAngle}deg) scale(1)`, offset: 1 }
      ], { duration: 850 + index * 80, delay: index * 45, easing: "ease-out", fill: "both" });
      roll.animations.push(animation);
      animation.finished.then(() => {
        if (activeRoll !== roll) return;
        die.classList.remove("rolling");
        die.querySelector(".die-number").textContent = roll.values[index];
      }).catch(() => {});
    });

    roll.previewTimer = setInterval(() => {
      if (activeRoll !== roll) return;
      dice.forEach(die => {
        if (die.classList.contains("rolling")) die.querySelector(".die-number").textContent = Math.floor(Math.random() * 10) + 1;
      });
    }, 65);
    Promise.all(roll.animations.map(animation => animation.finished.catch(() => {}))).then(() => settleRoll(roll));
    roll.fallbackTimer = setTimeout(() => settleRoll(roll), 2100);
  }

  function selectCount(value) {
    if (activeRoll) return;
    count = Math.min(5, Math.max(1, Math.round(Number(value) || 1)));
    countInputs.forEach(input => { input.checked = Number(input.value) === count; });
    document.querySelector("#dice-formula").textContent = `${count}D10`;
    document.querySelector("#dice-result-label").textContent = "Готов к броску";
    document.querySelector("#dice-results").textContent = "Выберите кубики и бросайте";
    document.querySelector("#dice-total").value = "—";
    renderDice();
    setBusy(false);
    try { localStorage.setItem(preferenceKey, String(count)); } catch {}
  }

  countInputs.forEach(input => input.addEventListener("change", () => selectCount(input.value)));
  document.querySelector("#dice-button").addEventListener("click", () => dialog.showModal());
  rollButton.addEventListener("click", startRoll);
  dialog.addEventListener("close", () => { if (activeRoll) settleRoll(activeRoll); });
  dialog.addEventListener("click", event => {
    if (event.target === dialog && event.clientX < dialog.getBoundingClientRect().left) dialog.close();
  });
  selectCount(count);
})();
