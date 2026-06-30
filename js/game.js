"use strict";
/* ---------------- Helpers ---------------- */
const $ = id => document.getElementById(id);
const screens = ["home","setup","lobby","hostQuestion","hostReveal","hostFinal","gameDetails","playerWait","playerAnswer","playerFeedback"];
function show(id){ screens.forEach(s => $(s).classList.toggle("hidden", s !== id)); }
const SHAPES = ["▲","◆","●","■"];
const NAMES = ["c0","c1","c2","c3"];
const PREFIX = "kahoot2game-";
// STUN + free TURN so players on different networks (mobile data, strict NAT) can connect
const PEER_CONFIG = {
  debug: 1,
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
    ]
  }
};
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function makePin(){ return String(Math.floor(100000 + Math.random()*900000)); }
function dn(p){ return (p.emoji ? p.emoji + " " : "") + esc(p.name); }
function ordinal(n){ const s=["th","st","nd","rd"], v=n%100; return n + (s[(v-20)%10] || s[v] || s[0]); }
function placeIcon(rank){ return rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":"🏅"; }
// Shrink the host question text until it fits its box (no scroll), for long questions
function fitHostQuestion(){
  const el = $("hqText");
  el.style.fontSize = "";
  let size = parseFloat(getComputedStyle(el).fontSize) || 28;
  let guard = 0;
  while(el.scrollHeight > el.clientHeight + 1 && size > 13 && guard < 80){
    size -= 1.5; el.style.fontSize = size + "px"; guard++;
  }
}

/* ---------------- Default quiz ---------------- */
const SAMPLE = [
  {q:"What is the capital of France?", a:["Paris","London","Berlin","Madrid"], correct:0},
  {q:"Which planet is known as the Red Planet?", a:["Venus","Mars","Jupiter","Saturn"], correct:1},
  {q:"How many continents are there on Earth?", a:["5","6","7","8"], correct:2},
  {q:"What is 9 × 7?", a:["56","63","72","49"], correct:1},
  {q:"Which animal is the largest living mammal?", a:["Elephant","Giraffe","Blue whale","Hippo"], correct:2},
];

/* ===========================================================
   SOUND ENGINE (procedural — no audio files needed)
=========================================================== */
const Sound = (() => {
  let ctx = null, master = null, muted = false, lobbyTimer = null, step = 0;
  let tensionTimer = null, tStep = 0, drumTimer = null, drumAccel = null, drumInterval = 95;
  const AC = window.AudioContext || window.webkitAudioContext;
  function ac(){
    if(!AC) return null;
    if(!ctx){ ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.22; master.connect(ctx.destination); }
    if(ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone(freq, start, dur, type, vol){
    const c = ac(); if(!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "square"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(vol || 0.3, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(master);
    o.start(start); o.stop(start + dur + 0.05);
  }
  // Short noise burst (snare-ish) for drum rolls / crashes
  function noiseHit(dur, vol, hp){
    const c = ac(); if(!c) return;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i] = (Math.random()*2 - 1) * (1 - i/n);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(vol || 0.2, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp || 1500;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }
  // Lobby loop: arpeggiated chord progression
  const CHORDS = [
    [261.63,329.63,392.00,523.25], // C
    [220.00,261.63,329.63,440.00], // Am
    [349.23,440.00,523.25,698.46], // F
    [392.00,493.88,587.33,783.99], // G
  ];
  function lobbyStep(){
    const c = ac(); if(!c) return;
    const t = c.currentTime + 0.02;
    const chord = CHORDS[Math.floor(step/4) % CHORDS.length];
    const arp = step % 4;
    tone(chord[arp], t, 0.18, "square", 0.10);
    if(arp === 0) tone(chord[0]/2, t, 0.42, "triangle", 0.16); // bass
    step++;
  }
  // Tension loop (during questions): pulsing heartbeat bass + minor arpeggio
  const TENSION = [220.00, 261.63, 329.63, 261.63]; // A minor arp: A C E C
  function tensionStep(){
    const c = ac(); if(!c) return;
    const t = c.currentTime + 0.02;
    tone(110, t, 0.10, "triangle", 0.17);                       // heartbeat bass
    tone(TENSION[tStep % TENSION.length], t, 0.11, "square", 0.07); // ticking arp
    tStep++;
  }
  return {
    unlock(){ ac(); },
    isMuted(){ return muted; },
    setMuted(m){ muted = m; if(master) master.gain.value = m ? 0 : 0.22; if(m){ this.stopLobby(); this.stopTension(); this.stopDrumroll(); } },
    startLobby(){ if(!AC || muted) return; this.stopLobby(); step = 0; lobbyStep(); lobbyTimer = setInterval(lobbyStep, 185); },
    stopLobby(){ if(lobbyTimer){ clearInterval(lobbyTimer); lobbyTimer = null; } },
    startTension(){ if(!AC || muted) return; this.stopTension(); tStep = 0; tensionStep(); tensionTimer = setInterval(tensionStep, 165); },
    stopTension(){ if(tensionTimer){ clearInterval(tensionTimer); tensionTimer = null; } },
    click(){ if(muted) return; const c = ac(); if(c) tone(880, c.currentTime, 0.07, "square", 0.25); },
    correct(){ if(muted) return; const c = ac(); if(!c) return; const t = c.currentTime; tone(659.25,t,0.12,"square",0.28); tone(987.77,t+0.1,0.22,"square",0.28); },
    wrong(){ if(muted) return; const c = ac(); if(!c) return; const t = c.currentTime; tone(311.13,t,0.18,"sawtooth",0.22); tone(207.65,t+0.12,0.3,"sawtooth",0.22); },
    tick(){ if(muted) return; const c = ac(); if(c) tone(1200, c.currentTime, 0.04, "square", 0.12); },
    beep(freq, dur){ if(muted) return; const c = ac(); if(c) tone(freq||880, c.currentTime, dur||0.15, "square", 0.3); },
    victory(){
      if(muted) return; const c = ac(); if(!c) return; this.stopLobby();
      let t = c.currentTime + 0.03;
      const seq = [[523.25,.16],[523.25,.16],[523.25,.16],[523.25,.4],[415.30,.4],[466.16,.4],[523.25,.18],[466.16,.18],[523.25,.7]];
      seq.forEach(([f,d]) => { tone(f,t,d,"square",0.26); tone(f/2,t,d,"triangle",0.14); t += d; });
    },
    startDrumroll(){
      if(!AC || muted) return;
      this.stopDrumroll(); drumInterval = 95;
      const step = () => {
        const intensity = Math.min(1, (95 - drumInterval) / 72); // 0 = slow, 1 = fast
        noiseHit(0.045, 0.13 + intensity*0.20, 1500 + intensity*1800); // louder + brighter as it speeds up
        drumTimer = setTimeout(step, drumInterval);
      };
      step();
    },
    // Ramp the drum speed from current to targetMs over durationMs (the build-up)
    accelerate(targetMs, durationMs){
      if(!AC || muted || !drumTimer) return;
      if(drumAccel) clearInterval(drumAccel);
      const start = drumInterval, steps = Math.max(1, Math.floor(durationMs / 80));
      let i = 0;
      drumAccel = setInterval(() => {
        i++;
        drumInterval = Math.max(targetMs, start + (targetMs - start) * (i / steps));
        if(i >= steps){ clearInterval(drumAccel); drumAccel = null; drumInterval = targetMs; }
      }, 80);
    },
    stopDrumroll(){
      if(drumTimer){ clearTimeout(drumTimer); drumTimer = null; }
      if(drumAccel){ clearInterval(drumAccel); drumAccel = null; }
    },
    cymbal(){ if(muted) return; noiseHit(0.55, 0.32, 5000); },
  };
})();

/* ---------------- Confetti ---------------- */
function confetti(){
  const colors = ["#e21b3c","#1368ce","#d89e00","#26890c","#6b21d9","#ffffff"];
  for(let i=0;i<100;i++){
    const d = document.createElement("div");
    d.className = "confetti";
    d.style.left = Math.random()*100 + "vw";
    d.style.background = colors[i % colors.length];
    d.style.animationDuration = (2.5 + Math.random()*2) + "s";
    d.style.animationDelay = (Math.random()*0.6) + "s";
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 5200);
  }
}

/* ---------------- QR code ---------------- */
function renderQR(){
  if(typeof QRCode === "undefined") return;       // lib failed to load — skip gracefully
  const url = location.href.split("#")[0];
  const el = $("qrCanvasLobby"); if(!el) return;   // QR only shown in the host lobby
  el.innerHTML = "";
  try{ new QRCode(el, { text:url, width:170, height:170, correctLevel: QRCode.CorrectLevel.M }); }
  catch(e){ console.warn("QR error", e); }
}

/* ---------------- Emoji picker ---------------- */
const EMOJIS = [
  "😀","😎","🤩","🥳","🤪","😜","🤓","🥸","🤠","😈",
  "👻","💀","🤡","👽","👾","🤖","💩","🐱","🐶","🦊",
  "🐼","🦄","🐸","🦁","🐯","🐵","🐧","🦖","🐙","🦈"
];
let selectedEmoji = EMOJIS[0];
function renderEmojiPicker(){
  const wrap = $("emojiPicker"); if(!wrap) return;
  wrap.innerHTML = "";
  EMOJIS.forEach((em, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = em;
    if(em === selectedEmoji) b.classList.add("sel");
    b.onclick = () => {
      selectedEmoji = em;
      wrap.querySelectorAll("button").forEach(x => x.classList.remove("sel"));
      b.classList.add("sel");
      Sound.unlock(); Sound.click();
    };
    wrap.appendChild(b);
  });
}

/* ---------------- Sound toggle button ---------------- */
$("soundBtn").onclick = () => {
  Sound.unlock();
  const nowMuted = !Sound.isMuted();
  Sound.setMuted(nowMuted);
  $("soundBtn").textContent = nowMuted ? "🔇" : "🔊";
  $("soundBtn").classList.toggle("off", nowMuted);
  if(!nowMuted){
    if(!$("lobby").classList.contains("hidden")) Sound.startLobby();
    else if(!$("hostQuestion").classList.contains("hidden") && qLive) Sound.startTension();
  }
};

/* ===========================================================
   QUIZ EDITOR (host setup)
=========================================================== */
let quiz = [];
function blankQ(){ return {q:"", a:["","","",""], correct:0, time:30}; }

function renderEditor(){
  const wrap = $("qeditor"); wrap.innerHTML = "";
  quiz.forEach((item, qi) => {
    const block = document.createElement("div");
    block.className = "qblock";
    let ansHtml = "";
    for(let i=0;i<4;i++){
      ansHtml += `
        <div class="ansrow">
          <input type="text" data-qi="${qi}" data-ai="${i}" class="ans-text"
                 placeholder="Answer ${SHAPES[i]}" value="${esc(item.a[i])}" />
          <label class="pick">
            <input type="radio" name="correct-${qi}" data-qi="${qi}" data-ai="${i}"
                   ${item.correct===i?"checked":""} style="width:auto" /> correct
          </label>
        </div>`;
    }
    block.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <strong>Question ${qi+1}</strong>
        <span class="q-time-wrap">⏱ <input type="number" class="q-time" data-qi="${qi}"
              value="${item.time||30}" min="5" max="120" /> s</span>
        <button class="btn ghost small del-q" data-qi="${qi}">Remove</button>
      </div>
      <textarea class="q-text" data-qi="${qi}" placeholder="Type your question…">${esc(item.q)}</textarea>
      ${ansHtml}`;
    wrap.appendChild(block);
  });

  const grow = el => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
  wrap.querySelectorAll(".q-text").forEach(el => {
    grow(el);
    el.oninput = e => { quiz[+e.target.dataset.qi].q = e.target.value; grow(e.target); };
  });
  wrap.querySelectorAll(".ans-text").forEach(el =>
    el.oninput = e => quiz[+e.target.dataset.qi].a[+e.target.dataset.ai] = e.target.value);
  wrap.querySelectorAll('input[type=radio]').forEach(el =>
    el.onchange = e => quiz[+e.target.dataset.qi].correct = +e.target.dataset.ai);
  wrap.querySelectorAll(".q-time").forEach(el =>
    el.oninput = e => quiz[+e.target.dataset.qi].time = e.target.value);
  wrap.querySelectorAll(".del-q").forEach(el =>
    el.onclick = e => { quiz.splice(+e.target.dataset.qi,1); if(!quiz.length) quiz.push(blankQ()); renderEditor(); });
}

$("hostBtn").onclick = () => { Sound.unlock(); if(!quiz.length) quiz=[blankQ()]; renderEditor(); renderSavedQuizzes(); show("setup"); };
$("addQBtn").onclick = () => {
  quiz.push(blankQ()); renderEditor();
  const blocks = $("qeditor").querySelectorAll(".qblock");
  const last = blocks[blocks.length - 1];
  if(last){
    last.scrollIntoView({behavior:"smooth", block:"center"});
    const ta = last.querySelector(".q-text"); if(ta) ta.focus();
  }
};
$("useDefaultBtn").onclick = () => { quiz = SAMPLE.map(x => ({q:x.q, a:[...x.a], correct:x.correct, time:30})); renderEditor(); };
$("backHomeBtn").onclick = () => show("home");

/* ---------- Local "database" (saved quizzes + game history) ---------- */
const LS_QUIZ = "kahoot2_quizzes", LS_HIST = "kahoot2_history";
function loadLS(key){ try{ return JSON.parse(localStorage.getItem(key)) || []; }catch(e){ return []; } }
function saveLS(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }

$("saveQuizBtn").onclick = () => {
  const err = validateQuiz();
  if(err){ $("setupErr").textContent = err; $("setupErr").classList.remove("hidden"); return; }
  $("setupErr").classList.add("hidden");
  const name = $("quizName").value.trim() || ("Quiz " + new Date().toLocaleDateString());
  const quizzes = loadLS(LS_QUIZ);
  quizzes.unshift({ name, questions: quiz.map(x=>({q:x.q, a:[...x.a], correct:x.correct, time:x.time||30})), savedAt: Date.now() });
  saveLS(LS_QUIZ, quizzes.slice(0, 20));
  $("quizName").value = name;
  renderSavedQuizzes();
  $("saveQuizBtn").textContent = "✅ Saved!";
  setTimeout(() => { $("saveQuizBtn").textContent = "💾 Save quiz"; }, 1500);
};

function renderSavedQuizzes(){
  const wrap = $("savedQuizzes"); if(!wrap) return;
  const quizzes = loadLS(LS_QUIZ);
  if(!quizzes.length){ wrap.innerHTML = ""; return; }
  wrap.innerHTML = `<div class="label" style="color:var(--ink);margin-top:12px">Saved quizzes</div>` +
    quizzes.map((qz,i)=>`<div class="saved-row">
      <span>${esc(qz.name)} <small>(${qz.questions.length} Q)</small></span>
      <span><button class="btn ghost small load-qz" data-i="${i}">Load</button>
      <button class="btn ghost small del-qz" data-i="${i}">🗑</button></span></div>`).join("");
  wrap.querySelectorAll(".load-qz").forEach(b => b.onclick = () => {
    const qz = loadLS(LS_QUIZ)[+b.dataset.i]; if(!qz) return;
    quiz = qz.questions.map(x=>({q:x.q, a:[...x.a], correct:x.correct, time:x.time||30}));
    $("quizName").value = qz.name;
    renderEditor();
    $("qeditor").scrollIntoView({behavior:"smooth", block:"start"});
  });
  wrap.querySelectorAll(".del-qz").forEach(b => b.onclick = () => {
    const arr = loadLS(LS_QUIZ); arr.splice(+b.dataset.i, 1); saveLS(LS_QUIZ, arr); renderSavedQuizzes();
  });
}

function recordHistory(ranked){
  if(!ranked.length) return;
  const w = ranked[0];
  const hist = loadLS(LS_HIST);
  hist.unshift({
    date: Date.now(),
    quizName: ($("quizName").value.trim()) || "Quiz",
    winner: { emoji: w.emoji || "🏅", name: w.name, score: w.score },
    players: ranked.length,
    quiz: quiz.map(x => ({ q:x.q, a:[...x.a], correct:x.correct, time:x.time||30 })),
    standings: ranked.map(p => ({ emoji:p.emoji, name:p.name, score:p.score, rank:p.rank })),
    rounds: matchLog.map(r => ({ ...r }))
  });
  saveLS(LS_HIST, hist.slice(0, 10));
}
function renderHistory(){
  const hist = loadLS(LS_HIST), card = $("historyCard");
  if(!card) return;
  if(!hist.length){ card.style.display = "none"; return; }
  card.style.display = "";
  $("historyList").innerHTML = hist.map((h,i) => {
    const d = new Date(h.date);
    const ds = d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    return `<div class="hist-row clickable" data-i="${i}">
      <span>${h.winner.emoji} <b>${esc(h.winner.name)}</b> <small>· ${esc(h.quizName)}</small></span>
      <span class="muted">${h.winner.score} pts · ${h.players}p · ${ds} ›</span></div>`;
  }).join("");
  $("historyList").querySelectorAll(".hist-row").forEach(row =>
    row.onclick = () => openGameDetails(+row.dataset.i));
}

/* ---------- Game details / analysis screen ---------- */
let gdReplayQuiz = null, gdReplayName = "", gdCurrent = null;
function openGameDetails(i){
  const h = loadLS(LS_HIST)[i];
  if(!h) return;
  gdCurrent = h;
  gdReplayQuiz = (h.quiz && h.quiz.length) ? h.quiz : null;
  gdReplayName = h.quizName || "";
  const d = new Date(h.date);
  const ds = d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});

  let html = `<div class="gd-head">
    <div><b>${esc(h.quizName||"Quiz")}</b><div class="muted">${ds} · ${h.players} players</div></div>
    <div style="text-align:right">${h.winner.emoji} <b>${esc(h.winner.name)}</b><div class="muted">${h.winner.score} pts</div></div>
  </div>`;

  if(h.standings && h.standings.length){
    html += `<div class="label" style="color:var(--ink);margin-top:14px">Final standings</div>`;
    html += h.standings.map(s =>
      `<div class="saved-row"><span>${s.rank}. ${s.emoji||""} ${esc(s.name)}</span><span class="pts">${s.score} pts</span></div>`).join("");
  }

  if(h.rounds && h.rounds.length){
    html += `<div class="label" style="color:var(--ink);margin-top:16px">Per-question analysis</div>`;
    html += h.rounds.map((r,qi) => {
      const total = r.players.length;
      const right = r.players.filter(p => p.correct).length;
      const pct = total ? Math.round(right/total*100) : 0;
      const opts = r.answers.map((a,ai) => {
        const c = (r.counts && r.counts[ai]) || 0;
        const w = total ? Math.round(c/total*100) : 0;
        const isC = ai === r.correct;
        return `<div class="opt-bar ${isC?'correct':''}">
          <span class="opt-lbl">${SHAPES[ai]} ${esc(a)} ${isC?'✓':''}</span>
          <span class="bar ${NAMES[ai]}" style="width:${Math.max(6,w)}%"></span>
          <span class="opt-cnt">${c}</span></div>`;
      }).join("");
      const rightN = r.players.filter(p=>p.correct).map(p=>`${p.emoji||""} ${esc(p.name)}`).join(", ") || "—";
      const wrongN = r.players.filter(p=>!p.correct).map(p=>`${p.emoji||""} ${esc(p.name)}`).join(", ") || "—";
      return `<div class="gd-q">
        <h4>Q${qi+1}. ${esc(r.question)}</h4>
        <div class="pie-wrap">
          <div class="pie" style="background:conic-gradient(var(--green) 0 ${pct}%, var(--red) ${pct}% 100%)">
            <span>${pct}%</span>
          </div>
          <div class="legend">
            <div><span class="g">●</span> ${right} acertaram</div>
            <div><span class="r">●</span> ${total-right} erraram</div>
          </div>
        </div>
        ${opts}
        <div class="namelist ok">✅ ${rightN}</div>
        <div class="namelist no">❌ ${wrongN}</div>
      </div>`;
    }).join("");
  } else {
    html += `<p class="muted" style="margin-top:12px">No per-question data for this game (older game).</p>`;
  }

  $("gdContent").innerHTML = html;
  $("gdReplayBtn").style.display = gdReplayQuiz ? "" : "none";
  show("gameDetails");
}
$("gdBackBtn").onclick = () => show("home");
$("gdReplayBtn").onclick = () => {
  if(!gdReplayQuiz) return;
  quiz = gdReplayQuiz.map(x => ({ q:x.q, a:[...x.a], correct:x.correct, time:x.time||30 }));
  $("quizName").value = gdReplayName;
  renderEditor(); renderSavedQuizzes();
  show("setup");
};
$("gdExportBtn").onclick = () => { if(gdCurrent) exportGameCSV(gdCurrent); };

function csvCell(v){ return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }
function exportGameCSV(h){
  const rows = [];
  rows.push(["Kahoot Vault — Game Analysis"]);
  rows.push(["Quiz", h.quizName || "Quiz"]);
  rows.push(["Date", new Date(h.date).toLocaleString()]);
  rows.push(["Players", h.players]);
  rows.push(["Winner", `${h.winner.name} (${h.winner.score} pts)`]);
  rows.push([]);
  if(h.standings && h.standings.length){
    rows.push(["Final standings"]);
    rows.push(["Rank", "Player", "Score"]);
    h.standings.forEach(s => rows.push([s.rank, s.name, s.score]));
    rows.push([]);
  }
  if(h.rounds && h.rounds.length){
    rows.push(["Per-question results"]);
    rows.push(["Q#", "Question", "Correct answer", "Player", "Player answer", "Result"]);
    h.rounds.forEach((r, qi) => {
      const correctAns = r.answers[r.correct] != null ? r.answers[r.correct] : "";
      r.players.forEach(p => {
        const chosen = (p.choice != null && r.answers[p.choice] != null) ? r.answers[p.choice] : "(no answer)";
        const result = p.correct ? "Correct" : (p.choice == null ? "No answer" : "Wrong");
        rows.push([qi+1, r.question, correctAns, p.name, chosen, result]);
      });
    });
  }
  const csv = rows.map(r => r.map(csvCell).join(",")).join("\r\n");
  const BOM = String.fromCharCode(0xFEFF); // helps Excel read UTF-8 accents
  const blob = new Blob([BOM + csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kahoot-vault-" + new Date(h.date).toISOString().slice(0,10) + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function validateQuiz(){
  if(!quiz.length) return "Add at least one question.";
  for(let i=0;i<quiz.length;i++){
    const it = quiz[i];
    if(!it.q.trim()) return `Question ${i+1} has no text.`;
    const filled = it.a.filter(a => a.trim()).length;
    if(filled < 2) return `Question ${i+1} needs at least 2 answers.`;
    if(!it.a[it.correct] || !it.a[it.correct].trim()) return `Question ${i+1}: the correct answer is empty.`;
  }
  return null;
}

/* ===========================================================
   HOST GAME LOGIC (PeerJS)
=========================================================== */
let peer = null;            // PeerJS instance
let conns = {};             // connId -> {conn, name, emoji, score, answered, lastDelta, rank}
let pin = null;
let curQ = -1;
let qStart = 0;
let timerInt = null;
let qLive = false;
let matchLog = [];          // per-question results for post-game analysis
let curQTime = 30;          // time (s) of the question currently in play
const QTIME = 30;           // default seconds per question
const RING_C = 2 * Math.PI * 32; // circumference of timer ring (r=32)

function broadcast(msg){ Object.values(conns).forEach(p => { try{ p.conn.send(msg); }catch(e){} }); }

let revealTimer = null;
let revealDone = false;

// Fullscreen 3-2-1 countdown, then run done()
function runCountdown(done){
  const overlay = $("countdown"), num = $("countdownNum");
  const seq = ["5","4","3","2","1","GO!"], freqs = [392,440,494,554,659,900];
  overlay.classList.remove("hidden");
  let i = 0;
  (function stepCd(){
    if(i >= seq.length){ overlay.classList.add("hidden"); done(); return; }
    num.textContent = seq[i];
    num.classList.remove("cd-anim"); void num.offsetWidth; num.classList.add("cd-anim");
    Sound.beep(freqs[i], i === seq.length-1 ? 0.32 : 0.15);
    i++;
    setTimeout(stepCd, 900);
  })();
}

// 5-second animated countdown on the scoreboard, then advance
function startRevealCountdown(last){
  revealDone = false;
  let n = 10;
  const el = $("revealCountdown");
  const label = last ? "Winners in " : "Next question in ";
  const paint = () => {
    el.textContent = label + n + "s";
    el.classList.remove("cd-pulse"); void el.offsetWidth; el.classList.add("cd-pulse");
  };
  paint();
  clearInterval(revealTimer);
  revealTimer = setInterval(() => {
    n--;
    if(n <= 0){ advanceFromReveal(last); return; }
    paint();
  }, 1000);
}
function advanceFromReveal(last){
  if(revealDone) return;
  revealDone = true;
  clearInterval(revealTimer); revealTimer = null;
  if(last) endGame(); else nextQuestion();
}

$("createGameBtn").onclick = () => {
  const err = validateQuiz();
  if(err){ $("setupErr").textContent = err; $("setupErr").classList.remove("hidden"); return; }
  $("setupErr").classList.add("hidden");
  // normalize: drop empty answer slots
  quiz = quiz.map(it => {
    const pairs = it.a.map((t,i)=>({t,i})).filter(p=>p.t.trim());
    const correctText = it.a[it.correct];
    const a = pairs.map(p=>p.t.trim());
    const correct = Math.max(0, a.indexOf(correctText.trim()));
    const time = Math.max(5, Math.min(120, parseInt(it.time) || 30));
    return {q:it.q.trim(), a, correct, time};
  });
  startHosting();
};

function startHosting(){
  pin = makePin();
  conns = {}; curQ = -1; matchLog = [];
  show("lobby");
  $("pinBox").textContent = pin;
  $("lobbyStatus").textContent = "Connecting…";
  $("startGameBtn").disabled = true;
  updateLobby();
  Sound.unlock(); Sound.startLobby();

  if(peer){ try{ peer.destroy(); }catch(e){} }
  peer = new Peer(PREFIX + pin, PEER_CONFIG);

  peer.on("open", () => { $("lobbyStatus").textContent = "Ready! Share the PIN above."; });

  peer.on("connection", conn => {
    conn.on("open", () => {
      conn.on("data", data => handlePlayerData(conn, data));
    });
    conn.on("close", () => { delete conns[conn.peer]; updateLobby(); });
    conn.on("error", () => {});
  });

  peer.on("error", e => {
    console.warn("Peer error:", e.type, e);
    if(e.type === "unavailable-id"){
      $("lobbyStatus").textContent = "PIN in use, getting a new one…";
      setTimeout(startHosting, 300);
    } else if(e.type === "network" || e.type === "server-error" || e.type === "socket-error"){
      $("lobbyStatus").textContent = "Network issue — reconnecting…";
    }
  });

  peer.on("disconnected", () => { try{ peer.reconnect(); }catch(e){} });
}

function handlePlayerData(conn, data){
  if(!data || typeof data !== "object") return;
  if(data.type === "join"){
    const name = (data.name||"Player").toString().slice(0,16).trim() || "Player";
    const emoji = (data.emoji||"😀").toString().slice(0,4);
    if(curQ >= 0){ conn.send({type:"joinDenied", reason:"Game already started."}); return; }
    if(Object.keys(conns).length >= EMOJIS.length){ conn.send({type:"joinDenied", reason:"Game is full (max " + EMOJIS.length + " players)."}); return; }
    conns[conn.peer] = {conn, name, emoji, score:0, answered:false, lastDelta:0, lastCorrect:false, rank:0, prevRank:0};
    conn.send({type:"joined", name, emoji});
    updateLobby();
  }
  else if(data.type === "answer"){
    const p = conns[conn.peer];
    if(!p || p.answered || curQ < 0 || !qLive) return;
    const q = quiz[curQ];
    if(typeof data.choice !== "number" || data.choice < 0 || data.choice >= q.a.length) return;
    p.answered = true;
    p.lastChoice = data.choice;
    const elapsed = (Date.now() - qStart) / 1000;
    const correct = data.choice === q.correct;
    let delta = 0;
    if(correct){
      const frac = Math.max(0, 1 - (elapsed / curQTime)); // 1 = instant, 0 = used all the time
      delta = Math.round(200 + 800 * frac);            // speed matters a lot: ~1000 fast, ~200 slow
    }
    p.lastCorrect = correct; p.lastDelta = delta; p.score += delta;
    conn.send({type:"answerAck"});
    updateAnsweredCount();
    if(everyoneAnswered()) endQuestion();
  }
}

function everyoneAnswered(){
  const ps = Object.values(conns);
  return ps.length > 0 && ps.every(p => p.answered);
}
function updateAnsweredCount(){
  const total = Object.keys(conns).length;
  const ans = Object.values(conns).filter(p=>p.answered).length;
  $("hqAnswered").textContent = `${ans}/${total}`;
}
function updateLobby(){
  const ps = Object.values(conns);
  $("playerCount").textContent = ps.length;
  $("lobbyPlayers").innerHTML = ps.map(p=>`<div class="chip">${dn(p)}</div>`).join("");
  $("startGameBtn").disabled = ps.length === 0;
}

$("cancelHostLink").onclick = () => { teardownPeer(); show("home"); };
$("startGameBtn").onclick = () => {
  if(!Object.keys(conns).length) return;
  Sound.unlock(); Sound.stopLobby();
  broadcast({type:"getReady"});
  runCountdown(() => nextQuestion());
};

function nextQuestion(){
  curQ++;
  if(curQ >= quiz.length){ endGame(); return; }
  const q = quiz[curQ];
  Object.values(conns).forEach(p => { p.answered = false; });

  // host view
  show("hostQuestion");
  $("hqProgress").textContent = `Q${curQ+1} / ${quiz.length}`;
  $("hqText").textContent = q.q;
  updateAnsweredCount();
  $("hqAnswers").innerHTML = q.a.map((t,i)=>
    `<div class="ans ${NAMES[i]}"><span class="shape">${SHAPES[i]}</span>${esc(t)}</div>`).join("");
  requestAnimationFrame(fitHostQuestion);   // auto-shrink long questions to fit

  curQTime = Math.max(5, Math.min(120, parseInt(q.time) || 30));

  // players view (send the answer texts so phones can show them on the buttons)
  broadcast({type:"question", index:curQ, total:quiz.length, question:q.q,
             answers:q.a, count:q.a.length, time:curQTime});

  qStart = Date.now();
  qLive = true;
  Sound.startTension();
  let t = curQTime;
  $("hqTimer").textContent = t;
  const ring = $("hqRing");
  if(ring){ ring.style.transition = "none"; ring.style.strokeDasharray = RING_C; ring.style.strokeDashoffset = "0"; }
  // force reflow then enable animated depletion
  if(ring){ void ring.getBBox; setTimeout(()=>{ ring.style.transition = "stroke-dashoffset 1s linear"; }, 20); }
  clearInterval(timerInt);
  timerInt = setInterval(() => {
    t--;
    $("hqTimer").textContent = Math.max(0,t);
    if(ring) ring.style.strokeDashoffset = (RING_C * (1 - t / curQTime)).toFixed(1);
    if(t <= 0) endQuestion();
  }, 1000);
}

function endQuestion(){
  clearInterval(timerInt);
  if(curQ < 0 || !qLive) return;
  qLive = false;
  Sound.stopTension();
  const q = quiz[curQ];

  // record this question's results (who chose what) for post-game analysis
  const counts = q.a.map(() => 0);
  const playersRec = Object.values(conns).map(p => {
    const answered = !!p.answered;
    const choice = answered ? p.lastChoice : null;
    if(answered && choice != null && choice >= 0 && choice < counts.length) counts[choice]++;
    return { name: p.name, emoji: p.emoji, choice, correct: answered ? !!p.lastCorrect : false };
  });
  matchLog.push({ question: q.q, answers: q.a.slice(), correct: q.correct, counts, players: playersRec });

  // highlight correct on host
  document.querySelectorAll("#hqAnswers .ans").forEach((el,i)=>{
    el.classList.toggle("win", i===q.correct);
    el.classList.toggle("dim", i!==q.correct);
  });

  // capture previous ranks, then re-rank by score
  Object.values(conns).forEach(p => { p.prevRank = p.rank; });
  const ranked = Object.values(conns).sort((a,b)=>b.score-a.score);
  ranked.forEach((p,i)=>p.rank=i+1);

  // tell each player their result
  Object.values(conns).forEach(p => {
    try{
      p.conn.send({type:"reveal", correct:p.lastCorrect, delta:p.lastDelta,
                   score:p.score, rank:p.rank, total:ranked.length});
    }catch(e){}
  });

  // Give everyone ~5s to see the correct answer, then scoreboard (or winners on the last question)
  setTimeout(()=>{
    const last = curQ+1 >= quiz.length;
    if(last){ endGame(); return; }   // last question: skip the ranking, go straight to the winners
    show("hostReveal");
    $("revealTitle").textContent = "Scoreboard";
    // Top 5 with up/down movement, appearing one by one (host screen only)
    $("revealLb").innerHTML = ranked.slice(0,5).map((p,i)=>{
      const move = p.prevRank > 0 ? (p.prevRank - p.rank) : 0;
      const dir = p.prevRank === 0 ? "new" : move > 0 ? "up" : move < 0 ? "down" : "same";
      const badge = dir === "new" ? "NEW"
        : dir === "up" ? `▲ ${move}`
        : dir === "down" ? `▼ ${-move}` : "—";
      return `<div class="item ${dir}" style="animation-delay:${(i*0.18).toFixed(2)}s">
        <span>${i+1}. ${dn(p)} <span class="move ${dir}">${badge}</span></span>
        <span class="pts">${p.score}</span></div>`;
    }).join("") || `<div class="item"><span>No players</span><span></span></div>`;
    $("nextBtn").textContent = "Skip →";
    // Each player sees their own score + position (normal questions only — the last one stays a surprise)
    Object.values(conns).forEach(p => {
      const move = p.prevRank > 0 ? (p.prevRank - p.rank) : 0;
      try{ p.conn.send({type:"standings", rank:p.rank, score:p.score, total:ranked.length, move}); }catch(e){}
    });
    startRevealCountdown(false);
  }, 5000);
}

$("nextBtn").onclick = () => advanceFromReveal(curQ+1 >= quiz.length);

function endGame(){ broadcastEnd(); showFinal(); }

function broadcastEnd(){
  const ranked = Object.values(conns).sort((a,b)=>b.score-a.score);
  ranked.forEach((p,i)=>p.rank=i+1);
  ranked.forEach(p => { try{ p.conn.send({type:"gameOver", score:p.score, rank:p.rank, total:ranked.length}); }catch(e){} });
}
function showFinal(){
  show("hostFinal");
  $("finalTitle").textContent = "🥁 And the winners are…";
  $("finalTitle").classList.remove("pop-in"); void $("finalTitle").offsetWidth; $("finalTitle").classList.add("pop-in");
  const ranked = Object.values(conns).sort((a,b)=>b.score-a.score);
  ranked.forEach((p,i)=>p.rank=i+1);
  recordHistory(ranked); renderHistory();
  const medal = {1:"🥇",2:"🥈",3:"🥉"};
  const byRank = r => ranked[r-1];
  const podHtml = rank => {
    const p = byRank(rank); if(!p) return "";
    const cls = rank===1?"p1":rank===2?"p2":"p3";
    return `<div class="pod ${cls} pod-hidden" id="pod-${rank}">
      <div class="medal">${medal[rank]}</div>
      <div class="nm">${dn(p)}</div><div class="pt">${p.score}</div></div>`;
  };
  // visual order on the podium: 2nd (left), 1st (center), 3rd (right) — all start hidden
  $("podium").innerHTML = podHtml(2) + podHtml(1) + podHtml(3);
  $("finalLb").innerHTML = "";

  Sound.startDrumroll();
  Sound.accelerate(16, 11000);   // drum keeps speeding up, climaxing right at the 1st-place reveal
  const reveal = rank => {
    const el = $("pod-" + rank);
    if(el){ el.classList.remove("pod-hidden"); el.classList.add("pod-reveal"); Sound.cymbal(); }
  };
  // 3s → 3rd, +3s → 2nd, then a big 5s build → 1st (fanfare + confetti + full board)
  setTimeout(() => reveal(3), 3000);
  setTimeout(() => reveal(2), 6000);
  setTimeout(() => {
    reveal(1);
    $("finalTitle").textContent = "🏆 Winners!";
    $("finalTitle").classList.remove("pop-in"); void $("finalTitle").offsetWidth; $("finalTitle").classList.add("pop-in");
    Sound.stopDrumroll();
    Sound.victory();
    confetti();
    $("finalLb").innerHTML = ranked.slice(0,8).map((p,i)=>
      `<div class="item"><span>${i+1}. ${dn(p)}</span><span class="pts">${p.score}</span></div>`).join("");
  }, 11000);
}
$("playAgainBtn").onclick = () => { teardownPeer(); show("home"); };

function teardownPeer(){
  clearInterval(timerInt);
  clearInterval(revealTimer); revealTimer = null;
  Sound.stopLobby();
  Sound.stopTension();
  Sound.stopDrumroll();
  try{ broadcast({type:"kicked"}); }catch(e){}
  if(peer){ try{ peer.destroy(); }catch(e){} peer=null; }
  conns={}; curQ=-1; pin=null;
}

/* ===========================================================
   PLAYER GAME LOGIC (PeerJS)
=========================================================== */
let myPeer = null;
let hostConn = null;
let myName = "";
let myEmoji = "😀";
let answeredThis = false;

$("joinBtn").onclick = joinGame;
$("joinPin").addEventListener("keydown", e=>{ if(e.key==="Enter") $("joinName").focus(); });
$("joinName").addEventListener("keydown", e=>{ if(e.key==="Enter") joinGame(); });

function joinGame(){
  Sound.unlock();
  const p = $("joinPin").value.replace(/\D/g,"").slice(0,6);
  const n = $("joinName").value.trim().slice(0,16);
  const status = $("joinStatus");
  if(p.length !== 6){ status.textContent = "Enter the 6-digit PIN."; return; }
  if(!n){ status.textContent = "Enter a nickname."; return; }
  myName = n; myEmoji = selectedEmoji;
  status.textContent = "Connecting…";
  $("joinBtn").disabled = true;

  if(myPeer){ try{ myPeer.destroy(); }catch(e){} }
  myPeer = new Peer(PEER_CONFIG);

  let connected = false;
  const giveUp = setTimeout(()=>{
    if(!connected){ status.textContent = "Couldn't find that game. Check the PIN and try again.";
      $("joinBtn").disabled=false; try{myPeer.destroy();}catch(e){} }
  }, 20000);

  myPeer.on("open", () => {
    hostConn = myPeer.connect(PREFIX + p, {reliable:true});
    hostConn.on("open", () => {
      connected = true; clearTimeout(giveUp);
      hostConn.send({type:"join", name:myName, emoji:myEmoji});
    });
    hostConn.on("data", handleHostData);
    hostConn.on("close", () => {
      if(connected){ $("pwTitle").textContent="Game ended"; $("pwMsg").textContent="The host closed the game."; show("playerWait"); }
    });
    hostConn.on("error", () => {});
  });

  myPeer.on("error", e => {
    clearTimeout(giveUp);
    if(e.type === "peer-unavailable"){ status.textContent = "No game found with that PIN."; }
    else { status.textContent = "Connection error. Try again."; }
    $("joinBtn").disabled = false;
  });
}

function handleHostData(data){
  if(!data || typeof data !== "object") return;
  switch(data.type){
    case "joined":
      $("joinBtn").disabled = false;
      $("pwTitle").textContent = "You're in!";
      $("pwName").textContent = myEmoji + " " + myName;
      $("pwMsg").textContent = "Waiting for the host to start…";
      show("playerWait");
      Sound.startLobby();
      break;
    case "joinDenied":
      $("joinStatus").textContent = data.reason || "Can't join.";
      $("joinBtn").disabled = false;
      try{ myPeer.destroy(); }catch(e){}
      break;
    case "getReady":
      $("pwTitle").textContent = "Get ready!";
      $("pwName").textContent = myEmoji + " " + myName;
      $("pwMsg").textContent = "Starting in 3… 2… 1…";
      show("playerWait");
      break;
    case "question":
      showPlayerQuestion(data);
      break;
    case "answerAck":
      $("pfIcon").textContent = "✔";
      $("pfText").textContent = "Answer locked in!";
      $("pfScore").textContent = "";
      $("pfRank").textContent = "Waiting for results…";
      show("playerFeedback");
      break;
    case "reveal":
      showPlayerReveal(data);
      break;
    case "standings":
      showPlayerStandings(data);
      break;
    case "gameOver":
      // Winner is revealed ONLY on the host screen — phones just build the hype
      Sound.stopTension(); Sound.stopLobby();
      $("pfIcon").textContent = "🥁";
      $("pfText").textContent = "Winners presentation!";
      $("pfScore").textContent = "";
      $("pfRank").textContent = "👀 Watch the main screen…";
      show("playerFeedback");
      Sound.startDrumroll(); Sound.accelerate(16, 9000);
      setTimeout(() => {
        Sound.stopDrumroll();
        $("pfIcon").textContent = "🎉";
        $("pfText").textContent = "Check the winners on the screen!";
        $("pfRank").textContent = "Thanks for playing!";
      }, 9500);
      break;
    case "kicked":
      $("pwTitle").textContent="Game ended"; $("pwMsg").textContent="The host closed the game.";
      show("playerWait");
      break;
  }
}

function showPlayerQuestion(d){
  answeredThis = false;
  show("playerAnswer");
  Sound.stopLobby(); Sound.startTension();
  $("paProgress").textContent = `Q${d.index+1} / ${d.total}`;
  $("paName").textContent = myEmoji + " " + myName;
  const n = d.count || (d.answers ? d.answers.length : 4);
  const grid = $("paGrid"); grid.innerHTML = "";
  for(let i=0;i<n;i++){
    const b = document.createElement("button");
    b.className = `tap ${NAMES[i]}`;
    b.textContent = SHAPES[i];   // phone shows only the colored shape — text stays on the TV
    b.onclick = () => sendAnswer(i, b);
    grid.appendChild(b);
  }
}
function sendAnswer(choice, btn){
  if(answeredThis) return;
  answeredThis = true;
  Sound.click();
  document.querySelectorAll("#paGrid .tap").forEach(el=>{ el.disabled=true; el.style.opacity=.4; });
  if(btn) btn.style.opacity = 1;
  try{ hostConn.send({type:"answer", choice}); }catch(e){}
}
function showPlayerReveal(d){
  show("playerFeedback");
  Sound.stopTension();
  if(d.correct){
    $("pfIcon").textContent = "✅";
    $("pfText").textContent = "Correct!";
    Sound.correct();
  } else {
    $("pfIcon").textContent = "❌";
    $("pfText").textContent = answeredThis ? "Wrong answer" : "Time's up!";
    Sound.wrong();
  }
  $("pfScore").textContent = d.delta > 0 ? "+" + d.delta + " points!" : "+0 points";
  $("pfRank").textContent = "Total: " + d.score + " pts";
}
function showPlayerStandings(d){
  show("playerFeedback");
  $("pfIcon").textContent = placeIcon(d.rank);
  $("pfText").textContent = ordinal(d.rank) + " place";
  $("pfScore").textContent = d.score + " pts";
  const mv = d.move > 0 ? `▲ Up ${d.move}!` : d.move < 0 ? `▼ Down ${-d.move}` : "Holding steady";
  $("pfRank").textContent = `${mv} • ${d.total} player${d.total===1?"":"s"}`;
  $("pfText").classList.remove("pop-in"); void $("pfText").offsetWidth; $("pfText").classList.add("pop-in");
}

/* safety: clean up on unload */
window.addEventListener("beforeunload", () => {
  try{ if(peer) peer.destroy(); }catch(e){}
  try{ if(myPeer) myPeer.destroy(); }catch(e){}
});

/* ---------------- Boot ---------------- */
renderEmojiPicker();
renderQR();
renderHistory();
show("home");
