const durations = { reset: 3 * 60, focus: 25 * 60, break: 5 * 60 };
const phases = {
  reset: { mark: "○", label: "Wall stare", eyebrow: "BEGIN WITH STILLNESS", headline: "Look at the wall.<br>Do nothing else.", detail: "Settle in. Let your mind get quiet.", reason: "Three quiet minutes create a clean edge between everyday noise and focused work." },
  focus: { mark: "●", label: "Deep work", eyebrow: "POMODORO SESSION", headline: "Focus on one thing.<br>That is enough.", detail: "No multitasking. Keep your phone out of reach.", reason: "This is protected time. Give the task your full attention until the bell." }
};
const activities = [
  { title: "Drink water and walk for a bit.", reason: "A little water and movement can refresh you after sitting and help you return more alert." },
  { title: "Stare at the wall for five minutes.", reason: "Quiet visual input lets mental clutter settle before the next focus block." },
  { title: "Listen to one specific song.", reason: "One familiar song can lift your energy after mentally heavy work—then stop there." },
  { title: "Just skim your study material.", reason: "A quick, low-pressure review gives recently studied ideas another chance to stick." },
  { title: "Look outside and breathe slowly.", reason: "Looking into the distance rests close-working eyes, while slow breaths ease tension." },
  { title: "Stretch your shoulders and neck.", reason: "A brief stretch relieves stiffness and gets blood moving without inviting distraction." }
];
const quotes = [
  "Rest is not a reward for work. It is part of the work.",
  "Small, honest progress is still progress.",
  "You do not need a perfect day. You need the next good block.",
  "Attention is the beginning of devotion.",
  "Let this pause make space for what matters next."
];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const el = Object.fromEntries([
  "studyOS", "book", "tree", "wallTimer", "coverStart",
  "phaseMark", "phaseLabel", "phaseDetail", "rightEyebrow", "headline",
  "reason", "breakThought", "quoteText", "timer", "progressBar",
  "startButton", "resetButton", "sessionCount", "treeMessage",
  "streakCount", "hoursCount", "completion",
  "todayPomodoros", "streakFlame", "streakBar", "completionStreak",
  "streakToggle", "streakPanel", "streakDaysTotal",
  "wallDone", "wallDoneBtn", "devNext"
].map(id => [id, document.getElementById(id)]));

let phase = "reset", remaining = durations.reset, running = false, intervalId = null, sessions = 0, lastActivity = -1;
let wallDoneShowing = false;
let soundContext = null, ambientNodes = [], ambientTimer = null;

const today = new Date().toISOString().slice(0, 10);

// ── Stats / Streak ────────────────────────────────────────────────────────────
// Schema:
// {
//   days: number,           — streak (consecutive days, accumulates forever)
//   hours: number,          — total deep-work hours (all time)
//   lastDate: "YYYY-MM-DD", — last day a pomodoro was finished
//   todaySessions: number,  — pomodoros finished today (resets each new day)
//   history: { [date]: count } — kept indefinitely for the 7-day bar
// }
function loadStats() {
  const raw = localStorage.getItem("studyOSStats");
  const defaults = { days: 0, hours: 0, lastDate: "", todaySessions: 0, history: {} };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.todaySessions === undefined) parsed.todaySessions = 0;
    if (!parsed.history) parsed.history = {};
    return { ...defaults, ...parsed };
  } catch { return defaults; }
}

const stats = loadStats();

// If we're on a new day, reset today's session counter for display
// (streak itself is only updated on completion, not at page load)
if (stats.lastDate && stats.lastDate !== today) {
  stats.todaySessions = 0;
}

function saveStats() {
  localStorage.setItem("studyOSStats", JSON.stringify(stats));
}

function updateStreak() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (stats.lastDate === today) {
    // Same calendar day — just add to today's count, streak stays as-is
    stats.todaySessions += 1;
  } else if (stats.lastDate === yesterday) {
    // Consecutive day — extend streak (accumulates indefinitely)
    stats.days += 1;
    stats.lastDate = today;
    stats.todaySessions = 1;
  } else {
    // First ever, or gap of > 1 day — reset streak to 1
    stats.days = 1;
    stats.lastDate = today;
    stats.todaySessions = 1;
  }
  // History map: kept forever (no pruning), used by the 7-day bar
  stats.history[today] = (stats.history[today] || 0) + 1;
  saveStats();
}

function renderStreakBar() {
  if (!el.streakBar) return;
  const spans = el.streakBar.querySelectorAll("span");
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10);
    const count = stats.history[d] || 0;
    spans[i].dataset.active = count > 0 ? "1" : "0";
    spans[i].title = count > 0 ? `${d}: ${count} session${count > 1 ? "s" : ""}` : d;
    spans[i].dataset.intensity = count === 0 ? "0" : count === 1 ? "1" : count < 4 ? "2" : "3";
  }
}

// ── Streak dropdown toggle ────────────────────────────────────────────────────
function toggleStreakPanel(force) {
  const open = force !== undefined ? force : el.streakToggle.getAttribute("aria-expanded") !== "true";
  el.streakToggle.setAttribute("aria-expanded", open);
  el.streakPanel.setAttribute("aria-hidden", !open);
  el.streakPanel.classList.toggle("open", open);
}

el.streakToggle.addEventListener("click", () => toggleStreakPanel());

// Close if clicking outside
document.addEventListener("click", e => {
  if (!el.streakToggle.contains(e.target) && !el.streakPanel.contains(e.target)) {
    toggleStreakPanel(false);
  }
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function ensureContext() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  soundContext ??= new Context();
  if (soundContext.state === "suspended") soundContext.resume();
  return soundContext;
}

function playChime(kind = "start") {
  const context = ensureContext(); if (!context) return;
  const notes = kind === "complete" ? [523.25, 659.25, 783.99, 1046.5] : kind === "pause" ? [392] : [523.25, 659.25];
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator(), gain = context.createGain(), start = context.currentTime + index * .12;
    oscillator.type = "sine"; oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(.08, start + .02); gain.gain.exponentialRampToValueAtTime(.0001, start + .82);
    oscillator.connect(gain).connect(context.destination); oscillator.start(start); oscillator.stop(start + .85);
  });
}

function chooseActivity() {
  let index;
  do index = Math.floor(Math.random() * activities.length);
  while (index === lastActivity && activities.length > 1);
  lastActivity = index;
  return activities[index];
}

function setContent() {
  const content = phase === "break"
    ? { mark: "✦", label: "Recovery break", eyebrow: "PAUSE WITH PURPOSE", detail: "This five minutes is part of the work.", ...chooseActivity() }
    : phases[phase];
  el.phaseMark.textContent = content.mark;
  el.phaseLabel.textContent = content.label;
  el.phaseDetail.textContent = content.detail;
  el.rightEyebrow.textContent = content.eyebrow;
  el.headline.innerHTML = content.title || content.headline;
  el.reason.textContent = content.reason;
  el.breakThought.hidden = phase !== "break";
  if (phase === "break") el.quoteText.textContent = quotes[Math.floor(Math.random() * quotes.length)];
}

function treeDescription(count) {
  return count === 0 ? "Your focus tree is a seedling."
    : count < 3 ? "A small branch reaches toward the light."
    : count < 6 ? "Your tree is finding its shape."
    : "A calm little forest is taking root.";
}

function setMood() {
  const cycleStep = phase === "break" ? (sessions + 3) % 4 : sessions % 4;
  const mood = ["day", "afternoon", "evening", "night"][cycleStep];
  el.studyOS.classList.remove("day", "afternoon", "evening", "night");
  el.studyOS.classList.add(mood);
}

function setScene(scene) {
  el.studyOS.classList.remove("scene-idle", "scene-wall", "scene-lowering", "scene-focus");
  el.studyOS.classList.add(`scene-${scene}`);
}

// ── Wall-done interstitial ────────────────────────────────────────────────────
function showWallDone() {
  wallDoneShowing = true;
  el.wallDone.setAttribute("aria-hidden", "false");
  el.wallDone.classList.add("show");
}

function hideWallDone() {
  wallDoneShowing = false;
  el.wallDone.classList.remove("show");
  el.wallDone.setAttribute("aria-hidden", "true");
}

el.wallDoneBtn.addEventListener("click", () => {
  hideWallDone();
  transitionToFocus();
});

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  el.timer.textContent = formatTime(remaining);
  el.timer.dateTime = `PT${remaining}S`;
  el.wallTimer.textContent = formatTime(remaining);
  el.wallTimer.dateTime = `PT${remaining}S`;
  el.progressBar.style.width = `${((durations[phase] - remaining) / durations[phase]) * 100}%`;

  el.sessionCount.textContent = sessions;
  el.tree.style.setProperty("--growth", Math.min(sessions, 7));

  const cycle = phase === "break" && sessions > 0 ? Math.floor((sessions - 1) / 4) + 1 : Math.floor(sessions / 4) + 1;
  const cycleStep = phase === "break" ? (sessions + 3) % 4 : sessions % 4;
  const timeName = ["Daylight", "Afternoon", "Evening", "Night"][cycleStep];
  el.treeMessage.textContent = `Cycle ${cycle} · ${timeName}. ${treeDescription(sessions)}`;

  // Streak badge (dropdown trigger)
  const streakDays = stats.days || 0;
  el.streakCount.textContent = `${streakDays} ${streakDays === 1 ? "day" : "days"}`;
  el.streakFlame.style.opacity = streakDays >= 2 ? "1" : "0";

  // Inside the dropdown
  if (el.streakDaysTotal) el.streakDaysTotal.textContent = `${streakDays} ${streakDays === 1 ? "day" : "days"}`;
  if (el.hoursCount) el.hoursCount.textContent = `${(stats.hours || 0).toFixed(1)} hrs`;
  if (el.todayPomodoros) {
    const tp = stats.todaySessions || 0;
    el.todayPomodoros.textContent = `${tp} session${tp === 1 ? "" : "s"}`;
  }
  renderStreakBar();

  el.startButton.textContent = running
    ? "Pause"
    : (remaining === durations[phase] && phase === "reset" ? "Start ritual" : "Resume");

  el.book.classList.toggle("is-focusing", running && phase === "focus");
  document.querySelector(".mug").classList.toggle("is-steaming", running);

  setMood();
  document.title = running
    ? `${formatTime(remaining)} · ${phase === "focus" ? "Focus" : phase === "break" ? "Break" : "Reset"} | StudyOS`
    : "StudyOS";
}

// ── Session completion ────────────────────────────────────────────────────────
function recordCompletion() {
  sessions += 1;
  stats.hours = (stats.hours || 0) + 25 / 60;
  updateStreak();

  if (el.completionStreak) {
    if (stats.days >= 2) {
      el.completionStreak.textContent = `🔥 ${stats.days}-day streak!`;
      el.completionStreak.style.display = "block";
    } else {
      el.completionStreak.style.display = "none";
    }
  }

  el.completion.classList.add("show");
  el.completion.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    el.completion.classList.remove("show");
    el.completion.setAttribute("aria-hidden", "true");
  }, 3200);
}

// ── Phase transitions ─────────────────────────────────────────────────────────
function nextPhase() {
  if (phase === "reset") {
    // Stop the timer and show the wall-done interstitial instead of auto-advancing
    running = false;
    window.clearInterval(intervalId);
    playChime("pause");
    showWallDone();
    return;
  } else if (phase === "focus") {
    recordCompletion();
    phase = "break";
    playChime("complete");
  } else {
    phase = "focus";
    playChime("start");
  }
  remaining = durations[phase];
  setContent();
  if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
  render();
}

function tick() {
  remaining -= 1;
  if (remaining <= 0) nextPhase();
  else render();
}

function beginRitual() {
  if (running) return;
  phase = "reset"; remaining = durations.reset;
  setContent(); setScene("wall");
  playChime("start");
  window.setTimeout(() => { running = true; intervalId = window.setInterval(tick, 1000); render(); }, 900);
  render();
}

function transitionToFocus() {
  running = false; window.clearInterval(intervalId); setScene("lowering"); playChime("pause");
  window.setTimeout(() => {
    phase = "focus"; remaining = durations.focus;
    setContent(); setScene("focus");
    running = true; playChime("start");
    intervalId = window.setInterval(tick, 1000);
    render();
  }, 1050);
}

function toggleTimer() {
  if (el.studyOS.classList.contains("scene-idle")) { beginRitual(); return; }
  if (wallDoneShowing) return; // don't allow pause/resume while interstitial is shown
  running = !running;
  if (running) { playChime("start"); intervalId = window.setInterval(tick, 1000); }
  else { playChime("pause"); window.clearInterval(intervalId); }
  render();
}

// ── DEV: skip-to-next button ──────────────────────────────────────────────────
// Manually advance through phases for testing. Remove before publishing.
el.devNext.addEventListener("click", () => {
  window.clearInterval(intervalId);
  running = false;
  // If wall-done is showing, dismiss it and go to focus
  if (wallDoneShowing) { hideWallDone(); transitionToFocus(); return; }
  // idle → start ritual
  if (el.studyOS.classList.contains("scene-idle")) { beginRitual(); return; }
  // wall → skip to wall-done screen
  if (el.studyOS.classList.contains("scene-wall")) { remaining = 0; nextPhase(); return; }
  // focus → complete session → break
  if (phase === "focus") { remaining = 0; recordCompletion(); phase = "break"; remaining = durations.break; setContent(); setScene("focus"); render(); return; }
  // break → back to focus
  if (phase === "break") { phase = "focus"; remaining = durations.focus; setContent(); render(); playChime("start"); intervalId = window.setInterval(tick, 1000); running = true; return; }
});

// ── Ambient sound ─────────────────────────────────────────────────────────────
function stopAmbient() {
  ambientNodes.forEach(node => { try { node.stop(); } catch {} });
  ambientNodes = []; window.clearInterval(ambientTimer); ambientTimer = null;
  document.querySelectorAll("[data-ambient]").forEach(button => button.classList.remove("active"));
}

function noiseSource(context, volume, color = "white") {
  const length = context.sampleRate * 2, buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0); let previous = 0;
  for (let i = 0; i < length; i += 1) { const white = Math.random() * 2 - 1; previous = color === "brown" ? (previous + .02 * white) / 1.02 : white; data[i] = color === "brown" ? previous * 3.5 : white; }
  const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
  filter.type = "lowpass"; filter.frequency.value = color === "rain" ? 750 : color === "brown" ? 650 : color === "cafe" ? 2400 : 1800;
  source.buffer = buffer; source.loop = true; gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(context.destination); source.start(); return source;
}

function cafeRoomTone(context) {
  const oscillator = context.createOscillator(), gain = context.createGain(), filter = context.createBiquadFilter();
  oscillator.type = "triangle"; oscillator.frequency.value = 147; filter.type = "lowpass"; filter.frequency.value = 280;
  gain.gain.value = .012; oscillator.connect(filter).connect(gain).connect(context.destination); oscillator.start(); return oscillator;
}

function startAmbient(type) {
  stopAmbient(); if (type === "off") return;
  const context = ensureContext(); if (!context) return;
  const profile = { rain: [.012, "rain"], cafe: [.028, "cafe"], forest: [.012, "white"], brown: [.06, "brown"] };
  ambientNodes.push(noiseSource(context, ...profile[type]));
  if (type === "cafe") ambientNodes.push(cafeRoomTone(context));
  if (type === "forest") ambientTimer = window.setInterval(() => {
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = "sine"; oscillator.frequency.value = 1100 + Math.random() * 900;
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.018, context.currentTime + .03);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .25);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .3);
  }, 1800);
  document.querySelector(`[data-ambient="${type}"]`).classList.add("active");
}

// ── Event listeners ───────────────────────────────────────────────────────────
el.startButton.addEventListener("click", toggleTimer);
el.coverStart.addEventListener("click", beginRitual);
el.resetButton.addEventListener("click", () => {
  window.clearInterval(intervalId);
  hideWallDone();
  phase = "reset"; remaining = durations.reset; running = false; sessions = 0; lastActivity = -1;
  setScene("idle"); setContent(); render();
});
document.querySelectorAll("[data-ambient]").forEach(button =>
  button.addEventListener("click", () => startAmbient(button.dataset.ambient))
);

// ── Boot ──────────────────────────────────────────────────────────────────────
setContent(); render();
