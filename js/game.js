"use strict";
/* ---------------- Helpers ---------------- */
const $ = id => document.getElementById(id);
const screens = ["home","setup","lobby","hostQuestion","hostReveal","hostFinal","playerWait","playerAnswer","playerFeedback"];
function show(id){ screens.forEach(s => $(s).classList.toggle("hidden", s !== id)); }
const SHAPES = ["▲","◆","●","■"];
const NAMES = ["c0","c1","c2","c3"];
const PREFIX = "kahoot2game-";
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function makePin(){ return String(Math.floor(100000 + Math.random()*900000)); }
function dn(p){ return (p.emoji ? p.emoji + " " : "") + esc(p.name); }

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
  let tensionTimer = null, tStep = 0;
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
    setMuted(m){ muted = m; if(master) master.gain.value = m ? 0 : 0.22; if(m){ this.stopLobby(); this.stopTension(); } },
    startLobby(){ if(!AC || muted) return; this.stopLobby(); step = 0; lobbyStep(); lobbyTimer = setInterval(lobbyStep, 185); },
    stopLobby(){ if(lobbyTimer){ clearInterval(lobbyTimer); lobbyTimer = null; } },
    startTension(){ if(!AC || muted) return; this.stopTension(); tStep = 0; tensionStep(); tensionTimer = setInterval(tensionStep, 165); },
    stopTension(){ if(tensionTimer){ clearInterval(tensionTimer); tensionTimer = null; } },
    click(){ if(muted) return; const c = ac(); if(c) tone(880, c.currentTime, 0.07, "square", 0.25); },
    correct(){ if(muted) return; const c = ac(); if(!c) return; const t = c.currentTime; tone(659.25,t,0.12,"square",0.28); tone(987.77,t+0.1,0.22,"square",0.28); },
    wrong(){ if(muted) return; const c = ac(); if(!c) return; const t = c.currentTime; tone(311.13,t,0.18,"sawtooth",0.22); tone(207.65,t+0.12,0.3,"sawtooth",0.22); },
    tick(){ if(muted) return; const c = ac(); if(c) tone(1200, c.currentTime, 0.04, "square", 0.12); },
    victory(){
      if(muted) return; const c = ac(); if(!c) return; this.stopLobby();
      let t = c.currentTime + 0.03;
      const seq = [[523.25,.16],[523.25,.16],[523.25,.16],[523.25,.4],[415.30,.4],[466.16,.4],[523.25,.18],[466.16,.18],[523.25,.7]];
      seq.forEach(([f,d]) => { tone(f,t,d,"square",0.26); tone(f/2,t,d,"triangle",0.14); t += d; });
    },
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
const EMOJIS = ["😀","😎","🤩","🥳","🤖","👾","🐱","🐶","🦊","🐼","🦄","🐸","🦁","🐯","🐲","🍕"];
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
function blankQ(){ return {q:"", a:["","","",""], correct:0}; }

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
                 placeholder="Answer ${SHAPES[i]}" value="${esc(item.a[i])}" maxlength="75" />
          <label class="pick">
            <input type="radio" name="correct-${qi}" data-qi="${qi}" data-ai="${i}"
                   ${item.correct===i?"checked":""} style="width:auto" /> correct
          </label>
        </div>`;
    }
    block.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>Question ${qi+1}</strong>
        <button class="btn ghost small del-q" data-qi="${qi}">Remove</button>
      </div>
      <textarea class="q-text" data-qi="${qi}" placeholder="Type your question…" maxlength="120">${esc(item.q)}</textarea>
      ${ansHtml}`;
    wrap.appendChild(block);
  });

  wrap.querySelectorAll(".q-text").forEach(el =>
    el.oninput = e => quiz[+e.target.dataset.qi].q = e.target.value);
  wrap.querySelectorAll(".ans-text").forEach(el =>
    el.oninput = e => quiz[+e.target.dataset.qi].a[+e.target.dataset.ai] = e.target.value);
  wrap.querySelectorAll('input[type=radio]').forEach(el =>
    el.onchange = e => quiz[+e.target.dataset.qi].correct = +e.target.dataset.ai);
  wrap.querySelectorAll(".del-q").forEach(el =>
    el.onclick = e => { quiz.splice(+e.target.dataset.qi,1); if(!quiz.length) quiz.push(blankQ()); renderEditor(); });
}

$("hostBtn").onclick = () => { Sound.unlock(); if(!quiz.length) quiz=[blankQ()]; renderEditor(); show("setup"); };
$("addQBtn").onclick = () => { quiz.push(blankQ()); renderEditor();
  window.scrollTo(0, document.body.scrollHeight); };
$("useDefaultBtn").onclick = () => { quiz = SAMPLE.map(x => ({q:x.q, a:[...x.a], correct:x.correct})); renderEditor(); };
$("backHomeBtn").onclick = () => show("home");

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
const QTIME = 20;           // seconds per question
const RING_C = 2 * Math.PI * 32; // circumference of timer ring (r=32)

function broadcast(msg){ Object.values(conns).forEach(p => { try{ p.conn.send(msg); }catch(e){} }); }

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
    return {q:it.q.trim(), a, correct};
  });
  startHosting();
};

function startHosting(){
  pin = makePin();
  conns = {}; curQ = -1;
  show("lobby");
  $("pinBox").textContent = pin;
  $("lobbyStatus").textContent = "Connecting…";
  $("startGameBtn").disabled = true;
  updateLobby();
  Sound.unlock(); Sound.startLobby();

  if(peer){ try{ peer.destroy(); }catch(e){} }
  peer = new Peer(PREFIX + pin, {debug:1});

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
    conns[conn.peer] = {conn, name, emoji, score:0, answered:false, lastDelta:0, lastCorrect:false, rank:0};
    conn.send({type:"joined", name, emoji});
    updateLobby();
  }
  else if(data.type === "answer"){
    const p = conns[conn.peer];
    if(!p || p.answered || curQ < 0 || !qLive) return;
    const q = quiz[curQ];
    if(typeof data.choice !== "number" || data.choice < 0 || data.choice >= q.a.length) return;
    p.answered = true;
    const elapsed = (Date.now() - qStart) / 1000;
    const correct = data.choice === q.correct;
    let delta = 0;
    if(correct){
      const frac = Math.max(0, 1 - (elapsed / QTIME));
      delta = Math.round(500 + 500 * frac);
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
  $("hqAnswered").textContent = Object.values(conns).filter(p=>p.answered).length;
}
function updateLobby(){
  const ps = Object.values(conns);
  $("playerCount").textContent = ps.length;
  $("lobbyPlayers").innerHTML = ps.map(p=>`<div class="chip">${dn(p)}</div>`).join("");
  $("startGameBtn").disabled = ps.length === 0;
}

$("cancelHostLink").onclick = () => { teardownPeer(); show("home"); };
$("startGameBtn").onclick = () => { if(Object.keys(conns).length){ Sound.stopLobby(); nextQuestion(); } };

function nextQuestion(){
  curQ++;
  if(curQ >= quiz.length){ endGame(); return; }
  const q = quiz[curQ];
  Object.values(conns).forEach(p => { p.answered = false; });

  // host view
  show("hostQuestion");
  $("hqProgress").textContent = `Q${curQ+1} / ${quiz.length}`;
  $("hqText").textContent = q.q;
  $("hqAnswered").textContent = "0";
  $("hqAnswers").innerHTML = q.a.map((t,i)=>
    `<div class="ans ${NAMES[i]}"><span class="shape">${SHAPES[i]}</span>${esc(t)}</div>`).join("");

  // players view
  broadcast({type:"question", index:curQ, total:quiz.length, question:q.q,
             count:q.a.length, time:QTIME});

  qStart = Date.now();
  qLive = true;
  Sound.startTension();
  let t = QTIME;
  $("hqTimer").textContent = t;
  const ring = $("hqRing");
  if(ring){ ring.style.transition = "none"; ring.style.strokeDasharray = RING_C; ring.style.strokeDashoffset = "0"; }
  // force reflow then enable animated depletion
  if(ring){ void ring.getBBox; setTimeout(()=>{ ring.style.transition = "stroke-dashoffset 1s linear"; }, 20); }
  clearInterval(timerInt);
  timerInt = setInterval(() => {
    t--;
    $("hqTimer").textContent = Math.max(0,t);
    if(ring) ring.style.strokeDashoffset = (RING_C * (1 - t / QTIME)).toFixed(1);
    if(t <= 0) endQuestion();
  }, 1000);
}

function endQuestion(){
  clearInterval(timerInt);
  if(curQ < 0 || !qLive) return;
  qLive = false;
  Sound.stopTension();
  const q = quiz[curQ];

  // highlight correct on host
  document.querySelectorAll("#hqAnswers .ans").forEach((el,i)=>{
    el.classList.toggle("win", i===q.correct);
    el.classList.toggle("dim", i!==q.correct);
  });

  // rank players
  const ranked = Object.values(conns).sort((a,b)=>b.score-a.score);
  ranked.forEach((p,i)=>p.rank=i+1);

  // tell each player their result
  Object.values(conns).forEach(p => {
    try{
      p.conn.send({type:"reveal", correct:p.lastCorrect, delta:p.lastDelta,
                   score:p.score, rank:p.rank, total:ranked.length});
    }catch(e){}
  });

  // host leaderboard
  setTimeout(()=>{
    show("hostReveal");
    const last = curQ+1 >= quiz.length;
    $("revealTitle").textContent = last ? "Final standings" : "Scoreboard";
    $("revealLb").innerHTML = ranked.slice(0,8).map((p,i)=>
      `<div class="item"><span>${i+1}. ${dn(p)}</span><span class="pts">${p.score}</span></div>`).join("")
      || `<div class="item"><span>No players</span><span></span></div>`;
    $("nextBtn").textContent = last ? "See winners 🏆" : "Next question →";
  }, 1200);
}

$("nextBtn").onclick = () => { if(curQ+1 >= quiz.length) endGame(); else nextQuestion(); };

function endGame(){ broadcastEnd(); showFinal(); }

function broadcastEnd(){
  const ranked = Object.values(conns).sort((a,b)=>b.score-a.score);
  ranked.forEach((p,i)=>p.rank=i+1);
  ranked.forEach(p => { try{ p.conn.send({type:"gameOver", score:p.score, rank:p.rank, total:ranked.length}); }catch(e){} });
}
function showFinal(){
  show("hostFinal");
  const ranked = Object.values(conns).sort((a,b)=>b.score-a.score);
  const top3 = ranked.slice(0,3);
  const order = [1,0,2]; // place 2nd, 1st, 3rd
  const medals = ["🥇","🥈","🥉"];
  $("podium").innerHTML = order.map(idx=>{
    if(!top3[idx]) return "";
    const cls = idx===0?"p1":idx===1?"p2":"p3";
    return `<div class="pod ${cls}"><div class="medal">${medals[idx]}</div>
      <div class="nm">${dn(top3[idx])}</div><div class="pt">${top3[idx].score}</div></div>`;
  }).join("");
  $("finalLb").innerHTML = ranked.slice(0,8).map((p,i)=>
    `<div class="item"><span>${i+1}. ${dn(p)}</span><span class="pts">${p.score}</span></div>`).join("");
  Sound.victory();
  confetti();
}
$("playAgainBtn").onclick = () => { teardownPeer(); show("home"); };

function teardownPeer(){
  clearInterval(timerInt);
  Sound.stopLobby();
  Sound.stopTension();
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
  myPeer = new Peer({debug:1});

  let connected = false;
  const giveUp = setTimeout(()=>{
    if(!connected){ status.textContent = "Couldn't find that game. Check the PIN and try again.";
      $("joinBtn").disabled=false; try{myPeer.destroy();}catch(e){} }
  }, 12000);

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
      break;
    case "joinDenied":
      $("joinStatus").textContent = data.reason || "Can't join.";
      $("joinBtn").disabled = false;
      try{ myPeer.destroy(); }catch(e){}
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
    case "gameOver":
      $("pfIcon").textContent = data.rank===1 ? "🏆" : "🎉";
      $("pfText").textContent = data.rank===1 ? "You won!" : `You finished #${data.rank} of ${data.total}`;
      $("pfScore").textContent = data.score + " pts";
      $("pfRank").textContent = "Thanks for playing!";
      show("playerFeedback");
      if(data.rank===1){ Sound.victory(); confetti(); }
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
  $("paProgress").textContent = `Q${d.index+1} / ${d.total}`;
  $("paName").textContent = myEmoji + " " + myName;
  $("paQuestion").textContent = d.question;
  const grid = $("paGrid"); grid.innerHTML = "";
  for(let i=0;i<d.count;i++){
    const b = document.createElement("button");
    b.className = `tap ${NAMES[i]}`;
    b.textContent = SHAPES[i];
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
  if(d.correct){
    $("pfIcon").textContent = "✅";
    $("pfText").textContent = "Correct!";
    Sound.correct();
  } else {
    $("pfIcon").textContent = "❌";
    $("pfText").textContent = answeredThis ? "Wrong answer" : "Time's up!";
    Sound.wrong();
  }
  $("pfScore").textContent = (d.delta>0 ? "+"+d.delta+" • " : "") + d.score + " pts";
  $("pfRank").textContent = `Rank ${d.rank} of ${d.total}`;
}

/* safety: clean up on unload */
window.addEventListener("beforeunload", () => {
  try{ if(peer) peer.destroy(); }catch(e){}
  try{ if(myPeer) myPeer.destroy(); }catch(e){}
});

/* ---------------- Boot ---------------- */
renderEmojiPicker();
renderQR();
show("home");
