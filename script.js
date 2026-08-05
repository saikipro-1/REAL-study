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
const el = Object.fromEntries(["studyOS", "book", "tree", "wallTimer", "coverStart", "phaseMark", "phaseLabel", "phaseDetail", "rightEyebrow", "headline", "reason", "breakThought", "quoteText", "timer", "progressBar", "startButton", "resetButton", "sessionCount", "treeMessage", "streakCount", "hoursCount", "completion"].map(id => [id, document.getElementById(id)]));

let phase = "reset", remaining = durations.reset, running = false, intervalId = null, sessions = 0, lastActivity = -1;
let soundContext = null, ambientNodes = [], ambientTimer = null;
const today = new Date().toISOString().slice(0, 10);
const stats = JSON.parse(localStorage.getItem("studyOSStats") || "{\"days\":0,\"hours\":0,\"lastDate\":\"\"}");

function formatTime(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function saveStats() { localStorage.setItem("studyOSStats", JSON.stringify(stats)); }
function ensureContext() { const Context = window.AudioContext || window.webkitAudioContext; if (!Context) return null; soundContext ??= new Context(); if (soundContext.state === "suspended") soundContext.resume(); return soundContext; }

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

function chooseActivity() { let index; do index = Math.floor(Math.random() * activities.length); while (index === lastActivity && activities.length > 1); lastActivity = index; return activities[index]; }
function setContent() {
  const content = phase === "break" ? { mark: "✦", label: "Recovery break", eyebrow: "PAUSE WITH PURPOSE", detail: "This five minutes is part of the work.", ...chooseActivity() } : phases[phase];
  el.phaseMark.textContent = content.mark; el.phaseLabel.textContent = content.label; el.phaseDetail.textContent = content.detail;
  el.rightEyebrow.textContent = content.eyebrow; el.headline.innerHTML = content.title || content.headline; el.reason.textContent = content.reason;
  el.breakThought.hidden = phase !== "break"; if (phase === "break") el.quoteText.textContent = quotes[Math.floor(Math.random() * quotes.length)];
}
function treeDescription(count) { return count === 0 ? "Your focus tree is a seedling." : count < 3 ? "A small branch reaches toward the light." : count < 6 ? "Your tree is finding its shape." : "A calm little forest is taking root."; }
function setMood() { el.studyOS.classList.toggle("evening", sessions >= 2 && sessions < 4); el.studyOS.classList.toggle("night", sessions >= 4); }
function setScene(scene) { el.studyOS.classList.remove("scene-idle", "scene-wall", "scene-lowering", "scene-focus"); el.studyOS.classList.add(`scene-${scene}`); }
function render() {
  el.timer.textContent = formatTime(remaining); el.timer.dateTime = `PT${remaining}S`; el.wallTimer.textContent = formatTime(remaining); el.wallTimer.dateTime = `PT${remaining}S`;
  el.progressBar.style.width = `${((durations[phase] - remaining) / durations[phase]) * 100}%`;
  el.sessionCount.textContent = sessions; el.tree.style.setProperty("--growth", Math.min(sessions, 7)); el.treeMessage.textContent = treeDescription(sessions);
  el.streakCount.textContent = `${stats.days || 0} ${stats.days === 1 ? "day" : "days"}`; el.hoursCount.textContent = `${stats.hours.toFixed(1)} hrs`;
  el.startButton.textContent = running ? "Pause" : (remaining === durations[phase] && phase === "reset" ? "Start ritual" : "Resume");
  el.book.classList.toggle("is-focusing", running && phase === "focus"); document.querySelector(".mug").classList.toggle("is-steaming", running);
  setMood(); document.title = running ? `${formatTime(remaining)} · ${phase === "focus" ? "Focus" : phase === "break" ? "Break" : "Reset"} | StudyOS` : "StudyOS";
}
function recordCompletion() {
  sessions += 1; stats.hours += 25 / 60;
  if (stats.lastDate !== today) { const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10); stats.days = stats.lastDate === yesterday ? stats.days + 1 : 1; stats.lastDate = today; }
  saveStats(); el.completion.classList.add("show"); el.completion.setAttribute("aria-hidden", "false"); window.setTimeout(() => { el.completion.classList.remove("show"); el.completion.setAttribute("aria-hidden", "true"); }, 2800);
}
function nextPhase() {
  if (phase === "reset") { transitionToFocus(); return; }
  else if (phase === "focus") { recordCompletion(); phase = "break"; playChime("complete"); }
  else { phase = "focus"; playChime("start"); }
  remaining = durations[phase]; setContent(); if (navigator.vibrate) navigator.vibrate([120, 80, 120]); render();
}
function tick() { remaining -= 1; if (remaining <= 0) nextPhase(); else render(); }
function beginRitual() {
  if (running) return;
  phase = "reset"; remaining = durations.reset; setContent(); setScene("wall");
  playChime("start"); window.setTimeout(() => { running = true; intervalId = window.setInterval(tick, 1000); render(); }, 900);
  render();
}
function transitionToFocus() {
  running = false; window.clearInterval(intervalId); setScene("lowering"); playChime("pause");
  window.setTimeout(() => { phase = "focus"; remaining = durations.focus; setContent(); setScene("focus"); running = true; playChime("start"); intervalId = window.setInterval(tick, 1000); render(); }, 1050);
}
function toggleTimer() { if (el.studyOS.classList.contains("scene-idle")) { beginRitual(); return; } running = !running; if (running) { playChime("start"); intervalId = window.setInterval(tick, 1000); } else { playChime("pause"); window.clearInterval(intervalId); } render(); }

function stopAmbient() { ambientNodes.forEach(node => { try { node.stop(); } catch {} }); ambientNodes = []; window.clearInterval(ambientTimer); ambientTimer = null; document.querySelectorAll("[data-ambient]").forEach(button => button.classList.remove("active")); }
function noiseSource(context, volume, color = "white") {
  const length = context.sampleRate * 2, buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0); let previous = 0;
  for (let i = 0; i < length; i += 1) { const white = Math.random() * 2 - 1; previous = color === "brown" ? (previous + .02 * white) / 1.02 : white; data[i] = color === "brown" ? previous * 3.5 : white; }
  const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
  filter.type = "lowpass"; filter.frequency.value = color === "rain" ? 750 : color === "brown" ? 650 : color === "cafe" ? 2400 : 1800;
  source.buffer = buffer; source.loop = true; gain.gain.value = volume; source.connect(filter).connect(gain).connect(context.destination); source.start(); return source;
}
function cafeRoomTone(context) {
  const oscillator = context.createOscillator(), gain = context.createGain(), filter = context.createBiquadFilter();
  oscillator.type = "triangle"; oscillator.frequency.value = 147; filter.type = "lowpass"; filter.frequency.value = 280;
  gain.gain.value = .012; oscillator.connect(filter).connect(gain).connect(context.destination); oscillator.start(); return oscillator;
}
function startAmbient(type) {
  stopAmbient(); if (type === "off") return; const context = ensureContext(); if (!context) return;
  const profile = { rain: [.012, "rain"], cafe: [.028, "cafe"], forest: [.012, "white"], brown: [.06, "brown"] };
  ambientNodes.push(noiseSource(context, ...profile[type]));
  if (type === "cafe") ambientNodes.push(cafeRoomTone(context));
  if (type === "forest") ambientTimer = window.setInterval(() => { const oscillator = context.createOscillator(), gain = context.createGain(); oscillator.type = "sine"; oscillator.frequency.value = 1100 + Math.random() * 900; gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(.018, context.currentTime + .03); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .25); oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .3); }, 1800);
  document.querySelector(`[data-ambient="${type}"]`).classList.add("active");
}

el.startButton.addEventListener("click", toggleTimer);
el.coverStart.addEventListener("click", beginRitual);
el.resetButton.addEventListener("click", () => { window.clearInterval(intervalId); phase = "reset"; remaining = durations.reset; running = false; sessions = 0; lastActivity = -1; setScene("idle"); setContent(); render(); });
document.querySelectorAll("[data-ambient]").forEach(button => button.addEventListener("click", () => startAmbient(button.dataset.ambient)));
setContent(); render();
