const socket = io();
const $ = id => document.getElementById(id);
const roles = {
  Villager:["👨‍🌾","ชาวบ้าน"],Seer:["🔮","ผู้หยั่งรู้"],Bodyguard:["🛡️","ผู้คุ้มกัน"],
  Hunter:["🏹","นายพราน"],Cupid:["💘","กามเทพ"],Tanner:["🤡","ยาจก"],
  Diseased:["🦠","ผู้ติดโรค"],Huntress:["🏹","พรานหญิง"],Drunk:["🍺","คนเมา"],
  Werewolf:["🐺","มนุษย์หมาป่า"],WolfCub:["🐺","ลูกหมาป่า"],DireWolf:["🐺","หมาป่าโลกันตร์"]
};

const roleImages = {
  Villager: "/images/roles/villager.png",
  Seer: "/images/roles/seer.png",
  Bodyguard: "/images/roles/bodyguard.png",
  Hunter: "/images/roles/hunter.png",
  Cupid: "/images/roles/cupid.png",
  Tanner: "/images/roles/tanner.png",
  Diseased: "/images/roles/diseased.png",
  Huntress: "/images/roles/huntress.png",
  Drunk: "/images/roles/drunk.png",
  Werewolf: "/images/roles/werewolf.png",
  WolfCub: "/images/roles/wolfcub.png",
  DireWolf: "/images/roles/direwolf.png"
};

let me=null, state=null, counts={};

function show(id){["home","lobby","game"].forEach(x=>$(x).classList.toggle("hidden",x!==id));}
function err(el,msg){$(el).textContent=msg||""}
function connect(action,payload){
  socket.emit(action,payload,(res)=>{
    if(!res?.ok) err("homeMsg",res?.error||"เกิดข้อผิดพลาด");
      if(res?.ok && (action==="createRoom" || action==="joinRoom")){
        localStorage.setItem("ww_name", payload.name || "");
        localStorage.setItem("ww_room", res.code || payload.code || "");
      }
  });
}
$("createBtn").onclick=()=>connect("createRoom",{name:$("name").value});
$("joinBtn").onclick=()=>connect("joinRoom",{name:$("name").value,code:$("roomCode").value});
$("copyBtn").onclick=()=>navigator.clipboard?.writeText(state.room);
$("newRoundBtn").onclick=()=>socket.emit("newRound",r=>{if(!r.ok)alert(r.error)});


// ===== GAME BACKGROUND MUSIC =====
let currentGameMusic = "";
let gameMusicDelayTimer = null;

function updateGameMusic(s){
  // ถ้าเสียง Popup เช้า/กลางคืนกำลังเล่น ห้ามเพลงพื้นหลังแทรก
  if (phasePopupSoundActive) return;

  const bgm = document.getElementById("gameBgm");
  if(!bgm || !s) return;

  let file = "";

  // Lobby / รอ HOST / รอผู้เล่น
  if(!s.started){
    file = "/audio/WereWolf Theme.mp3";
  }
  // กลางคืน
  else if(s.phase === "night"){
    file = "/audio/Night Falls.mp3";
  }
  // กลางวัน
  else if(s.phase === "day"){
    file = "/audio/Morning After.mp3";
  }
  else{
    return;
  }

  if(currentGameMusic === file) return;

  // ยกเลิก Timer เพลงเก่าก่อน
  if (gameMusicDelayTimer) {
    clearTimeout(gameMusicDelayTimer);
    gameMusicDelayTimer = null;
  }

  // กลางวัน/กลางคืน รอ 7 วินาที เพื่อให้เสียง Popup เล่นก่อน
  if (s.started && (s.phase === "day" || s.phase === "night")) {
    gameMusicDelayTimer = setTimeout(() => {
      currentGameMusic = file;
      bgm.src = file;
      bgm.loop = true;
      bgm.volume = 0.45;
      bgm.play().catch(()=>{});
      gameMusicDelayTimer = null;
    }, 0);

    return;
  }

  // Lobby เล่นตามปกติ ไม่ต้องรอ
  currentGameMusic = file;
  bgm.src = file;
  bgm.loop = true;
  bgm.volume = 0.45;

  bgm.play().catch(()=>{
    // มือถือบางเครื่องจะยังไม่อนุญาตเสียง
    // จนกว่าผู้เล่นจะแตะหน้าจอครั้งแรก
  });
}

document.addEventListener("pointerdown", ()=>{
  const bgm = document.getElementById("gameBgm");
  if(bgm && bgm.paused && currentGameMusic){
    bgm.play().catch(()=>{});
  }
}, {passive:true});

socket.on("state",s=>{
  const previousPhase = state?.phase || null;
  const previousNight = state?.night || 0;

  state=s; me=s.me;

  // RESET ROLE CARD EVERY NEW ROUND
  if (
    previousPhase === "gameover" &&
    s.phase === "lobby" &&
    !s.started
  ) {
    const roleCard = document.getElementById("roleFlipCard");
    if (roleCard) roleCard.classList.add("role-card-hidden");
  }

// เริ่มเกม / เริ่มรอบใหม่ ให้คว่ำการ์ด Role อัตโนมัติ
if (
  s.started &&
  (previousPhase === null || previousPhase === "lobby")
) {
  const roleCard = document.getElementById("roleFlipCard");
  if (roleCard) roleCard.classList.add("role-card-hidden");
}

  // กลับ Lobby / เริ่มรอบใหม่ -> รีเซ็ต Popup Phase
  // เพื่อให้ Night 1 ของเกมรอบใหม่แสดง Popup อีกครั้ง
  if (!s.started || s.phase === "lobby") {
  lastPhasePopupKey = null;

  // Reset Action UI state ก่อนเริ่มรอบใหม่
  window.selectedPlayerId = null;
  window.playerCardAction = null;
  window.cupidSelectedIds = [];

  document.querySelectorAll("#gamePlayers .player").forEach(card => {
    card.classList.remove("selectable-player", "selected-player", "guard-disabled");
    card.onclick = null;
    card.title = "";
  });

  const actionsEl = document.getElementById("actions");
  if (actionsEl) actionsEl.innerHTML = "";

  const actionTitleEl = document.getElementById("actionTitle");
  if (actionTitleEl) actionTitleEl.textContent = "";
}

  // ===== DAY / NIGHT PHASE POPUP TRIGGER =====
  if (s.started) {
    const phaseKey = s.phase === "night"
      ? `night-${s.night || 0}`
      : s.phase === "day"
        ? `day-${s.night || 0}`
        : null;

    if (phaseKey) {
      // State แรกหลัง Refresh / Reconnect:
      // จำ Phase ปัจจุบันไว้ แต่ไม่แสดง Popup ซ้ำ
      if (!previousState) {
        lastPhasePopupKey = phaseKey;
      }
      // แสดง Popup เฉพาะตอน Phase เปลี่ยนจริงระหว่างเล่น
      else if (
        phaseKey !== lastPhasePopupKey &&
        (s.phase !== previousPhase || s.night !== previousNight)
      ) {
        lastPhasePopupKey = phaseKey;
        showPhasePopup(s.phase);
      }
    }
  }
  // ===== END PHASE POPUP TRIGGER =====

  // ถ้าเริ่มรอบใหม่ ให้ปิดหน้าสรุปเกมเก่าของผู้เล่นทุกคน
if (s.phase !== "gameover") {
  document.getElementById("gameOverPopup")?.remove();
}

// GAME OVER ต้องแสดงผลทันที
  if (s.phase === "gameover") {
    show("game");
    setTimeout(() => renderGameOver(), 100);
    return;
  }

  // ===== GLOBAL CHAT : คนตายอ่านได้ แต่พิมพ์ไม่ได้ =====
  const globalChatInput = $("globalChatInput");
  const globalChatSendBtn = $("globalChatSendBtn");

  if (globalChatInput && globalChatSendBtn) {
    const canSendGlobalChat = !!me?.alive;

    globalChatInput.disabled = !canSendGlobalChat;
    globalChatSendBtn.disabled = !canSendGlobalChat;

    globalChatInput.placeholder = canSendGlobalChat
      ? "พิมพ์ข้อความ..."
      : "💀 คุณเสียชีวิตแล้ว — อ่านแชทได้เท่านั้น";
  }

  // เกมจบ / กลับ Lobby = ล้าง Wolf Chat เก่าออกจากหน้าจอ
  if (!s.started) {
    const wolfChatMessages = $("wolfChatMessages");
    const wolfChatMsg = $("wolfChatMsg");
    const wolfChatInput = $("wolfChatInput");

    if (wolfChatMessages) wolfChatMessages.innerHTML = "";
    if (wolfChatMsg) wolfChatMsg.textContent = "";
    if (wolfChatInput) wolfChatInput.value = "";
  }

  // แสดง Wolf Chat เฉพาะผู้เล่นที่ Server อนุญาต
  const wolfChatCard = $("wolfChatCard");
  if (wolfChatCard) {
    wolfChatCard.classList.toggle("hidden", !me?.canWolfChat);
  }

  // ถ้าเป็นการเปลี่ยน Day/Night ที่มี Phase Popup
  // ให้เสียง Popup เล่นก่อน แล้วค่อยเปิดเพลงพื้นหลังเมื่อเสียง Popup จบ
  const phasePopupSound =
    s.phase === "night"
      ? document.getElementById("wolfHowlSound")
      : s.phase === "day"
      ? document.getElementById("roosterSound")
      : null;

  if (phasePopupSound && !phasePopupSound.paused && !phasePopupSound.ended) {
    phasePopupSound.addEventListener("ended", () => {
      updateGameMusic(s);
    }, { once: true });
  } else {
    updateGameMusic(s);
  }

  if(!s.started){
    renderLobby();
    show("lobby");
  } else {
    renderGame();
    show("game");

    // โหลดแชทใหญ่ของห้องนี้
    loadGlobalChatHistory();
  }
});

function renderLobby(){
  $("room").textContent=state.room;$("bigCode").textContent=state.room;
  $("playerCount").textContent=state.players.length;
  $("roleNeed").textContent=state.players.length;
  $("players").innerHTML=state.players.map(p=>`<div class="player ${p.alive?'':'dead'}"><span>${p.name}</span>${p.isHost?'<span class="hosttag">HOST</span>':''}</div>`).join("");
  const host=state.hostId===me.id;
  $("hostPanel").classList.toggle("hidden",!host);$("waitPanel").classList.toggle("hidden",host);
  if(host) renderRoles();
}
function renderRoles(){
  const order=Object.keys(roles);

  $("roles").innerHTML=order.map(r=>{
    const [emoji,name]=roles[r], n=counts[r]||0;
    const image=roleImages[r];

    return `
      <div class="role role-card ${n>0 ? 'role-selected' : ''}">
        <div class="role-image-box">
          <img class="role-select-image" src="${image}" alt="${name}">
          ${n>0 ? `<div class="role-count-badge">×${n}</div>` : ''}
        </div>
        <div class="role-select-info">
          <div class="role-select-name">${name}</div>
          <small class="muted">${r}</small>
          <div class="counter role-select-counter">
            <button onclick="changeRole('${r}',-1)">−</button>
            <span>${n}</span>
            <button onclick="changeRole('${r}',1)">+</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  $("roleTotal").textContent=
    Object.values(counts).reduce((a,b)=>a+b,0);
}

window.changeRole=(r,d)=>{counts[r]=Math.max(0,Math.min(15,(counts[r]||0)+d));renderRoles()};
$("startBtn").onclick=()=>{
  console.log("START GAME CLICK", {
    counts: counts,
    totalRoles: Object.values(counts).reduce((a,b)=>a+b,0),
    players: state?.players?.length
  });

  socket.emit("startGame",{roleCounts:counts},r=>{
    console.log("START GAME RESPONSE", r);
    if(!r?.ok) {
      alert("START GAME ERROR: " + (r?.error || "Unknown error"));
      err("hostMsg",r?.error || "Unknown error");
    }
  });
};

function closeDeathPopup(){
  // ปิด Popup ผู้เสียชีวิตก่อน
  document.getElementById("deathPopup")?.remove();

  // HOST ค่อยแจ้ง Server หลัง Popup เดิมปิดสนิท
  if(state?.phase==="memorial" && state?.hostId===me?.id){
    setTimeout(()=>{
      socket.emit("continueMemorial", r=>{
        if(r && r.error){
          console.error("MEMORIAL CONTINUE ERROR:",r.error);
        }
      });
    },0);
  }
}

function showDeathPopup(names){
  document.getElementById("deathPopup")?.remove();

  // เสียงประกาศผู้เสียชีวิต
  const deathSound = new Audio("/sounds/death-bell.mp3");
  deathSound.volume = 0.8;
  deathSound.play().catch(()=>{});
 let d=document.createElement("div");
 d.id="deathPopup";
 d.innerHTML=`<div class="deathBox">🕯️<h2>${names.join("<br>")}</h2><b>ได้เสียชีวิตแล้ว</b><p>โปรดไว้อาลัยแด่ผู้เสียชีวิต</p><p id="deathTime">ปิดอัตโนมัติใน 5 วินาที</p><button onclick="closeDeathPopup()">ปิด</button></div>`;
 document.body.appendChild(d);
 let t=5;
 let x=setInterval(()=>{
  t--;
  let e=document.getElementById("deathTime");
  if(e)e.textContent=`ปิดอัตโนมัติใน ${t} วินาที`;
  if(t<=0){
      clearInterval(x);
      closeDeathPopup();

      // ให้ HOST สั่งเดินเกมต่ออัตโนมัติ เฉพาะเมื่อยังอยู่ Memorial
      // และ Popup ยังไม่ได้ถูกปิดเอง
      if(
        document.getElementById("deathPopup") &&
        state?.phase==="memorial" &&
        state?.hostId===me?.id
      ){
        socket.emit("continueMemorial", r=>{
          if(r && r.error) console.error("AUTO MEMORIAL ERROR:",r.error);
        });
      }
    }
 },1000);
}


function showNoDeathPopup(type){
  document.getElementById("noDeathPopup")?.remove();

  // เสียงประกาศไม่มีผู้เสียชีวิต
  const noDeathSound = new Audio("/sounds/death-bell.mp3");
  noDeathSound.volume = 0.8;
  noDeathSound.play().catch(()=>{});

  const isNight = type === "night";
  const icon = isNight ? "🌙" : "🗳️";
  const title = isNight
    ? "คืนนี้ไม่มีผู้เสียชีวิต"
    : "ไม่มีผู้เสียชีวิตจากการประหาร";

  const d=document.createElement("div");
  d.id="noDeathPopup";
  d.className="deathPopup";


  d.innerHTML=`
    <div class="deathBox">
      <button
        onclick="closeNoDeathPopup()"
        style="position:absolute;right:14px;top:10px;border:0;background:transparent;font-size:26px;cursor:pointer"
      >✕</button>

      <div style="font-size:48px">${icon}</div>
      <h2>${title}</h2>

      <p>Popup จะปิดใน
        <b id="noDeathTime">5</b>
        วินาที
      </p>

      <button class="primary full" onclick="closeNoDeathPopup()">
        ปิด
      </button>
    </div>
  `;

  document.body.appendChild(d);

  let t=5;

  const timer=setInterval(()=>{
    t--;

    const el=document.getElementById("noDeathTime");
    if(el) el.textContent=t;

    if(t<=0){
      clearInterval(timer);
      closeNoDeathPopup();
    }
  },1000);
}

function closeNoDeathPopup(){
  document.getElementById("noDeathPopup")?.remove();
}

function renderMemorial(){
  showDeathPopup(state.memorialDeaths||[]);
  $("phaseTitle").textContent="🕯️ ไว้อาลัย";
  $("gameMsg").textContent="ขอร่วมไว้อาลัยแด่ผู้จากไป";

  $("actions").innerHTML=(state.memorialDeaths||[])
    .map(name=>`<div class="notice">🕯️ <b>${name}</b></div>`)
    .join("");


}

function renderGame(){
  $("phaseTitle").textContent=state.phase==="night"?"🌙 NIGHT":state.phase==="day"?"☀️ DAY":state.phase==="hunter"?"🏹 HUNTER":"🏆 GAME OVER";
  $("nightNo").textContent=state.night?` ${state.night}`:"";
  $("newRoundBtn").classList.toggle("hidden",state.hostId!==me.id || state.phase!=="gameover");
    const wolfTeam = state.wolfTeam || [];
    const wolfTeamHtml = wolfTeam.length
      ? `<div class="wolf-team-box">
          <div class="wolf-team-title">🐺 ทีมหมาป่า</div>
          <div class="wolf-team-list">
            ${wolfTeam.map(w=>`
              <div class="wolf-team-member ${w.id===me.id?'is-me':''} ${w.alive?'':'is-dead'}">
                <span>🐺 ${w.name}</span>
                <span>${w.id===me.id?'คุณ':(w.alive?'🟢':'💀')}</span>
              </div>
            `).join("")}
          </div>
          <div class="wolf-team-note">ไม่เปิดเผยว่าใครเป็นหมาป่าประเภทใด</div>
        </div>`
      : "";

    $("myRole").innerHTML=`
      <div class="myrole">
        <div class="roleImageWrap"><img class="roleImage" src="${roleImages[me.role] || ''}" alt="${roles[me.role]?.[1] || me.role}"></div>
      <div class="rolePlayerName">👤 ${me.name}</div>
        <div class="roleTitle">${roles[me.role]?.[1] || me.role}${me.wasDrunk && me.role !== "Drunk" ? " (Drunk)" : ""}</div>
        <div class="faction">${me.faction}</div>
        ${me.role==="Drunk"&&state.night<2
          ? '<div class="notice">🍺 คุณยังไม่รู้บทที่แท้จริงจนกว่าจะถึงคืนที่ 2</div>'
          : ''}
        ${wolfTeamHtml}
      </div>`;
  const voteSummary = state.voteSummary;
  $("gamePlayers").innerHTML=state.players.map(p=>{
    const votes = voteSummary?.tally?.[p.id] || 0;
    const voteBadge = state.phase==="day" && p.alive
      ? `<div class="vote-badge ${votes>0?'has-votes':''}">🗳️ ${votes} โหวต</div>`
      : "";
    return `<div class="player ${p.alive?'':'dead'}">
      <span>${p.name}${me.role==="Cupid" && (state.cupidLovers||[]).includes(p.id) ? " 💘" : ""}</span>
      <span>${p.isHost?'👑':''} ${p.alive?'🟢':'💀'}</span>
      ${voteBadge}
    </div>`;
  }).join("");

  let voteProgress=document.getElementById("voteProgress");
  if(state.phase==="day" && voteSummary){
    if(!voteProgress){
      voteProgress=document.createElement("div");
      voteProgress.id="voteProgress";
      $("gamePlayers").before(voteProgress);
    }
    voteProgress.innerHTML=`✅ ยืนยันโหวตแล้ว <b>${voteSummary.votedCount}</b> / <b>${voteSummary.voterCount}</b> คน`;
  }else if(voteProgress){
    voteProgress.remove();
  }
  $("actions").innerHTML="";

  if(state.phase==="gameover"){
    $("phaseTitle").textContent="";
    $("nightNo").textContent="";
    $("gameMsg").textContent="";
    $("actions").innerHTML="";
    renderGameOver();
    return;
  }
  if(state.phase==="memorial"){renderMemorial();return}
  if(state.phase!=="memorial") window.memorialLocalStart=null;
  if(state.phase==="hunter"){renderHunter();return}
  if(state.phase==="night"){renderNight();return}
  if(state.phase==="day"){renderDay();return}
}

function candidates(excludeSelf=true){
  return state.players.filter(p=>p.alive&&(!excludeSelf||p.id!==me.id));
}
function buttonsForPlayers(cb){
  $("actions").innerHTML=candidates().map(p=>`<button class="target" onclick="${cb}('${p.id}')">${p.name}</button>`).join("");
}

function renderWolfVoteStatus() {
  const summary = state.wolfVoteSummary;
  if (!summary || !summary.wolfCount) return "";

  const rows = summary.choices.map(w => `
    <div class="wolf-vote-row">
      <span class="wolf-voter">🐺 ${w.name}</span>
      <span class="wolf-arrow">➜</span>
      <span class="${w.targetName ? 'wolf-target' : 'wolf-waiting'}">
        ${w.targetName ? w.targetName : 'ยังไม่เลือก'}
      </span>
    </div>
  `).join("");

  let status = "";

  if (summary.unanimous) {
    status = `
      <div class="wolf-vote-status agreed">
        ✅ ทีมหมาป่าเลือก <b>${summary.targetName}</b> ตรงกันแล้ว
      </div>`;
  } else if (summary.selectedCount === 0) {
    status = `
      <div class="wolf-vote-status waiting">
        🕐 รอทีมหมาป่าเลือกเหยื่อ
      </div>`;
  } else {
    status = `
      <div class="wolf-vote-status disagree">
        ⚠️ เลือกแล้ว ${summary.selectedCount} / ${summary.wolfCount} คน<br>
        ทีมหมาป่าต้องเลือกเหยื่อคนเดียวกัน
      </div>`;
  }

  return `
    <div class="wolf-vote-box">
      <div class="wolf-vote-title">🩸 การเลือกเหยื่อของทีม</div>
      ${rows}
      ${status}
      <div class="wolf-vote-help">
        สามารถเปลี่ยนเป้าหมายได้จนกว่าทีมจะเลือกตรงกัน
      </div>
    </div>`;
}

function renderNight(){
  $("actionTitle").textContent="🌙 ความสามารถของคุณ";
  const wolfVoteHtml = renderWolfVoteStatus();
  if(!me.alive){$("actions").innerHTML='<div class="notice">คุณเสียชีวิตแล้ว รอดูเกมต่อได้</div>';return}
  if(me.role==="Villager"||me.role==="Tanner"||me.role==="Diseased"||me.role==="Hunter"||(me.role==="Drunk"&&state.night<2)){
    $("actions").innerHTML='<div class="notice">คืนนี้คุณไม่มี Action ที่ต้องทำ</div>';return;
  }
  if(me.role==="Cupid"&&state.night===1){
    if((state.cupidLovers||[]).length===2){
      $("actions").innerHTML='<div class="notice">💘 เลือกคู่รักเรียบร้อยแล้ว</div>';
      return;
    }

    setupCupidCardSelection();
    return;
  }

  if(me.role==="DireWolf" && state.night===1 && !state.direCompanion){
  $("actionTitle").textContent="🐺 เลือก Companion";
  setupPlayerCardSelection("companion","เลือก Companion จากรายชื่อผู้เล่น","✓ ยืนยัน Companion");
  return;
}
    if(
      me.role==="Werewolf" ||
      me.role==="WolfCub" ||
      me.role==="DireWolf" ||
      (
        me.role==="Drunk" &&
        ["Werewolf","WolfCub","DireWolf"].includes(me.trueRole) &&
        state.night>=2
      )
    ){
      $("actionTitle").textContent="🐺 เลือก เหยื่อ";

      setupPlayerCardSelection(
        "wolf",
        "เลือก เหยื่อจากรายชื่อผู้เล่น",
        "✓ ยืนยัน เป้าหมาย"
      );

      // แสดงว่าเพื่อนหมาป่าแต่ละคนเลือกใคร
      $("actions").insertAdjacentHTML("afterbegin", wolfVoteHtml);
      return;
    }

  if(me.role==="Seer"){if(state.seerDone){$("actions").innerHTML='<div class="notice">🔮 ตรวจสอบเรียบร้อยแล้ว</div>';return;}
    $("actionTitle").textContent="🔮 ตรวจสอบ 1 คน";
    setupPlayerCardSelection("seer","เลือกผู้เล่นที่ต้องการตรวจสอบ","✓ ยืนยันการตรวจ");return;
  }
  if(me.role==="Bodyguard"){
    $("actionTitle").textContent="🛡️ ปกป้อง 1 คน";

    if(state.guardDone){
      $("actions").innerHTML='<div class="notice">🛡️ ยืนยันการปกป้องเรียบร้อยแล้ว<br>⏳ รอผู้เล่นอื่นดำเนินการ...</div>';
      return;
    }

    setupPlayerCardSelection(
      "guard",
      "เลือกผู้เล่นที่ต้องการปกป้อง",
      "✓ ยืนยันการปกป้อง"
    );
    return;
  }
  if(me.role==="Huntress"){
    $("actionTitle").textContent="🏹 พรานหญิง";

    // พรานหญิงยิงได้เพียง 1 ครั้งตลอดทั้งเกม
    if(state.huntressUsed){
      $("actions").innerHTML='<div class="notice">🏹 คุณใช้ความสามารถยิงไปแล้ว</div>';
      return;
    }

    $("actionTitle").textContent="🏹 พรานหญิง — จะใช้พลังคืนนี้หรือไม่?";
    $("actions").innerHTML='<button class="primary" onclick="chooseHuntress()">ใช้พลัง</button><button onclick="skipAction()">ไม่ใช้คืนนี้</button>';
    return;
  }
}
function act(type,data={}){
  socket.emit("nightAction",{type,...data},r=>{
    if(!r.ok){
      alert(r.error);
      return;
    }

    // Wolf ต้องสามารถเปลี่ยนเป้าหมายได้
    // รอ state ล่าสุดจาก Server แล้ว render ใหม่
    if(type==="wolf"){
      return;
    }

    $("actions").innerHTML=
      '<div class="notice">✅ บันทึก Action แล้ว รอผู้เล่นคนอื่น...</div>';
  });
}
window.submitWolf=id=>act("wolf",{target:id});
window.submitSeer=id=>act("seer",{target:id});
window.submitGuard=id=>act("guard",{target:id});
window.submitCompanion=id=>act("companion",{target:id});
window.chooseHuntress=()=>{setupPlayerCardSelection("huntress","เลือกเป้าหมายจากรายชื่อผู้เล่น","✓ ยืนยันเป้าหมาย")};
window.submitHuntress=id=>act("huntress",{target:id});
window.pickCup=id=>{if(!window.cupA)window.cupA=id;else if(window.cupA!==id)window.cupB=id;document.querySelectorAll("#cup .target").forEach(b=>b.classList.remove("selected"));if(window.cupA)$("cup-"+window.cupA)?.classList.add("selected");if(window.cupB)$("cup-"+window.cupB)?.classList.add("selected")};
window.submitCupid=()=>{if(!window.cupA||!window.cupB)return alert("เลือก 2 คนก่อน");act("cupid",{a:window.cupA,b:window.cupB})};
window.skipAction=()=>{ $("actions").innerHTML='<div class="notice">คืนนี้ไม่ใช้พลัง</div>' };


function renderDay(){
  $("actionTitle").textContent="☀️ โหวตประหาร";
  console.log("DAY DEBUG", {phase:state.phase, me:me, candidates:candidates().map(p=>({id:p.id,name:p.name,alive:p.alive}))});
  $("gameMsg").textContent=state.message||"พูดคุยกับผู้เล่นแล้วเลือก 1 คน";
  if(!me.alive){$("actions").innerHTML='<div class="notice">คุณเสียชีวิตแล้ว</div>';return}
  if(state.voteSummary?.myVoted){
    $("actions").innerHTML=`<div class="notice">✅ คุณใช้สิทธิ์โหวตในรอบนี้แล้ว<br>⏳ รอผู้เล่นคนอื่นโหวตให้ครบ</div>`;
    return;
  }
  setupPlayerCardSelection("vote","เลือกผู้เล่นที่ต้องการโหวตออก","✓ ยืนยันการโหวต");
}
window.votePlayer=id=>socket.emit("vote",{target:id},r=>{
  if(!r.ok){
    alert(r.error);
    return;
  }

  if(state.voteSummary){
    state.voteSummary.myVoted=true;
  }

  $("actions").innerHTML=`<div class="notice">✅ คุณใช้สิทธิ์โหวตในรอบนี้แล้ว<br>⏳ รอผู้เล่นคนอื่นโหวตให้ครบ</div>`;
});

function renderHunter(){
  $("actionTitle").textContent="🏹 นายพราน";
  $("actions").innerHTML="";

  const myId=me?.id;
  const hunterId=state.pendingHunter;

  if(!myId || !hunterId || myId !== hunterId){
    $("actions").innerHTML='<div class="notice">🏹 รอนายพรานเลือกเป้าหมาย...</div>';
    return;
  }

  // นายพรานตายแล้ว แต่ยังมีสิทธิ์เลือกยิงคนที่ยังมีชีวิต
  setupPlayerCardSelection(
    "hunter",
    "เลือกผู้เล่นที่นายพรานต้องการยิง",
    "🏹 ยืนยันการยิง"
  );
}

window.shoot=id=>socket.emit("hunterShot",{target:id},r=>{if(!r.ok)alert(r.error)});

function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderGameOver(){
  console.log("GAMEOVER DEBUG:", {phase: state.phase, winner: state.winner, gameSummary: state.gameSummary});
  const actionCard=document.getElementById("actionCard");
  if(actionCard) actionCard.style.display="none";

  const map={
    Village:"🏆 ฝ่ายชาวบ้านชนะ",
    Werewolf:"🐺 ฝ่ายหมาป่าชนะ",
    Tanner:"🤡 ยาจกชนะ",
    Draw:"🤝 เสมอกัน — ไม่มีผู้รอดชีวิตทั้ง 2 ฝ่าย",
  };

  $("actionTitle").textContent="";
  $("actions").innerHTML="";
  $("gameMsg").textContent="";

  // ลบ popup เก่าก่อน ป้องกันซ้ำ
  document.getElementById("gameOverPopup")?.remove();

  const d=document.createElement("div");
  d.id="gameOverPopup";
  d.className="deathPopup";

  // ===== GAME OVER : PLAYER ROLE SUMMARY =====
  const summary = Array.isArray(state.gameSummary)
    ? state.gameSummary
    : [];

  const roleSummaryHTML = summary.length
    ? `
      <div style="
        margin:16px 0 14px;
        padding:12px;
        background:rgba(255,255,255,.06);
        border-radius:12px;
        text-align:left;
        max-height:300px;
        overflow-y:auto;
      ">
        <div style="
          font-weight:800;
          text-align:center;
          margin-bottom:10px;
          font-size:17px;
        ">📋 สรุปบทบาทผู้เล่น</div>

        ${summary.map(p => `
          <div style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:10px;
            padding:8px 4px;
            border-bottom:1px solid rgba(255,255,255,.08);
          ">
            <span style="font-weight:700;">
              ${p.alive ? "❤️" : "💀"} ${escapeHtml(p.name)}
            </span>

            <span style="text-align:right;">
              ${p.emoji || "🎭"} ${escapeHtml(p.roleName || p.role)}
              ${
                p.role === "Drunk" && p.trueRoleName
                  ? `<br><small>↳ บทจริง: ${p.trueRoleEmoji || "🎭"} ${escapeHtml(p.trueRoleName)}</small>`
                  : ""
              }
            </span>
          </div>
        `).join("")}
      </div>
    `
    : "";

  d.innerHTML=`
    <div class="deathBox">
      <div style="font-size:42px">🏆</div>
      <h1 style="margin:10px 0">GAME OVER</h1>
      <h2>${map[state.winner] || state.winner}</h2>
      <p>เกมจบแล้ว</p>
      ${roleSummaryHTML}
      ${
        state.hostId===me.id
        ? '<button class="primary full" onclick="newRound()">🔄 เริ่มเกมใหม่</button>'
        : '<p>⏳ รอ HOST เริ่มเกมใหม่</p>'
      }
    </div>
  `;

  document.body.appendChild(d);
}
window.newRound=()=>socket.emit("newRound",r=>{
  if(!r.ok){
    alert(r.error);
    return;
  }
  document.getElementById("gameOverPopup")?.remove();

  const actionCard=document.getElementById("actionCard");
  if(actionCard) actionCard.style.display="";
});
socket.on("privateResult",r=>{
  if(r.type==="seer"){
    $("private").innerHTML=`<div class="notice">🔮 ผลการตรวจ<br><br>${r.target}<br><b>${r.isWolf?"🐺 ฝ่ายหมาป่า":"🏡 ฝ่ายชาวบ้าน"}</b></div>`;
  }
});
socket.on("noDeathResult",r=>{
  if(r && r.type==="vote"){
    showNoDeathPopup("vote");
  }
});

socket.on("nightResult",r=>{
  $("gameMsg").textContent=r.message||"";

  // คืนนี้ไม่มีผู้เสียชีวิต
  if(Array.isArray(r.deaths) && r.deaths.length===0){
    showNoDeathPopup("night");
  }
});


// Connection safety: a room shown on screen may no longer exist after a server
// restart / republish. Force the client to verify it instead of showing stale UI.
let lastRoomCode = null;
socket.on("state", s => { lastRoomCode = s.room || lastRoomCode; });

socket.on("disconnect", () => {
  if (state?.room) {
    err("homeMsg", "การเชื่อมต่อกับ Server หลุด กรุณารอเชื่อมต่อใหม่");
  }
});

socket.on("connect", () => {
    const savedName = localStorage.getItem("ww_name");
    const savedRoom = localStorage.getItem("ww_room");

    // พยายามกลับเข้าห้องเดิมอัตโนมัติ
    if (savedName && savedRoom) {
        socket.emit("joinRoom", {
            name: savedName,
            code: savedRoom
        }, r => {
            if (r?.ok) {
                lastRoomCode = savedRoom;
                err("homeMsg", "");
                return;
            }

            // ห้องถูกลบ/Server restart
            localStorage.removeItem("ww_room");
            state = null;
            me = null;
            counts = {};
            show("home");
            $("roomCode").value = savedRoom;
            err("homeMsg", r?.error || "ไม่สามารถกลับเข้าห้องเดิมได้");
        });
        return;
    }

    // กรณีไม่มีข้อมูล reconnect
    if (lastRoomCode && state) {
        socket.emit("checkRoom", { code: lastRoomCode }, r => {
            if (!r?.ok) {
                state = null;
                me = null;
                counts = {};
                show("home");
                $("roomCode").value = lastRoomCode;
                err("homeMsg", "ห้องเดิมหมดอายุ กรุณาให้ HOST สร้างห้องใหม่");
            }
        });
    }
});

// ===== NO GAME COUNTDOWN =====

window.continueMemorial=()=>{
  socket.emit("continueMemorial",r=>{
    if(!r?.ok) alert(r?.error||"ไม่สามารถดำเนินเกมต่อได้");
  });
};

/* ===== PLAYER CARD ACTION SELECT ===== */

window.selectedPlayerId = null;
window.playerCardAction = null;


/* ===== CUPID : SELECT 2 PLAYERS FROM PLAYER CARDS ===== */
window.setupCupidCardSelection = function() {
  window.cupidSelectedIds = [];

  const aliveIds = state.players
    .filter(p => p.alive)
    .map(p => p.id);

  document.querySelectorAll("#gamePlayers .player").forEach((card, index) => {
    const p = state.players[index];

    card.classList.remove("selectable-player", "selected-player");
    card.onclick = null;
    card.title = "";

    if (!p || !aliveIds.includes(p.id)) return;

    card.classList.add("selectable-player");

    card.onclick = () => {
      const id = p.id;
      const pos = window.cupidSelectedIds.indexOf(id);

      if (pos >= 0) {
        window.cupidSelectedIds.splice(pos, 1);
        card.classList.remove("selected-player");
      } else {
        if (window.cupidSelectedIds.length >= 2) return;

        window.cupidSelectedIds.push(id);
        card.classList.add("selected-player");
      }

      const selected = window.cupidSelectedIds
        .map(x => state.players.find(z => z.id === x))
        .filter(Boolean);

      if (selected.length === 0) {
        $("actions").innerHTML =
          '<div class="notice player-select-help">💘 เลือกผู้เล่น 2 คนให้เป็นคู่รัก</div>';
      } else if (selected.length === 1) {
        $("actions").innerHTML =
          '<div class="selected-summary">💘 คนที่ 1: <b>' +
          escapeHtml(selected[0].name) +
          '</b><br>เลือกคนที่ 2</div>';
      } else {
        $("actions").innerHTML =
          '<div class="selected-summary">💘 คู่รักที่เลือก<br><b>' +
          escapeHtml(selected[0].name) + ' ❤️ ' +
          escapeHtml(selected[1].name) +
          '</b></div>' +
          '<button class="primary full" onclick="confirmCupidCardSelection()">💘 ยืนยันคู่รัก</button>';
      }
    };
  });

  $("actions").innerHTML =
    '<div class="notice player-select-help">💘 เลือกผู้เล่น 2 คนให้เป็นคู่รัก</div>';
};

window.confirmCupidCardSelection = function() {
  const ids = window.cupidSelectedIds || [];

  if (ids.length !== 2) {
    return alert("กรุณาเลือกผู้เล่นให้ครบ 2 คน");
  }

  const a = ids[0];
  const b = ids[1];

  window.cupidSelectedIds = [];
  act("cupid", {a, b});
};

window.setupPlayerCardSelection = function(actionType, title, confirmText) {
  window.selectedPlayerId = null;
  window.playerCardAction = actionType;

  // Bodyguard เลือกผู้เล่นที่ยังมีชีวิตทั้งหมด รวมตัวเอง
  // Action อื่นใช้กติกาเดิม
  const allowed = actionType === "guard"
    ? state.players.filter(p => p.alive).map(p => p.id)
    : actionType === "hunter"
      ? state.players.filter(p => p.alive && p.id !== me.id).map(p => p.id)
      : candidates().map(p => p.id);

  document.querySelectorAll("#gamePlayers .player").forEach((card, index) => {
    const p = state.players[index];

    card.classList.remove(
      "selectable-player",
      "selected-player",
      "guard-disabled"
    );

    // ล้าง onclick เก่าทุกครั้ง
    card.onclick = null;
    card.title = "";

    if (!p || !allowed.includes(p.id)) return;

    // Bodyguard: คนที่ป้องกันเมื่อคืนกดซ้ำไม่ได้
    if (
      actionType === "guard" &&
      p.id === state.lastGuardTarget
    ) {
      card.classList.add("guard-disabled");
      card.title = "ป้องกันผู้เล่นคนนี้เมื่อคืนแล้ว";
      return;
    }

    card.classList.add("selectable-player");

    card.onclick = () => {
      window.selectedPlayerId = p.id;

      document.querySelectorAll("#gamePlayers .player")
        .forEach(x => x.classList.remove("selected-player"));

      card.classList.add("selected-player");

      $("actions").innerHTML =
        `<div class="selected-summary">
           <span>ผู้เล่นที่เลือก:</span>
           <b>✓ ${p.name}</b>
         </div>
         <button class="primary full" onclick="confirmPlayerCardAction()">
           ${confirmText || "✓ ยืนยัน"}
         </button>`;
    };
  });

  $("actions").innerHTML =
    `<div class="notice player-select-help">
       👆 ${title || "เลือกผู้เล่นจากรายชื่อด้านบน"}
     </div>`;
};

window.confirmPlayerCardAction = function() {
  const id = window.selectedPlayerId;

  if (!id) return alert("กรุณาเลือกผู้เล่นก่อน");

  const action = window.playerCardAction;

  window.selectedPlayerId = null;
  window.playerCardAction = null;

  if (action === "vote") return votePlayer(id);
  if (action === "wolf") return submitWolf(id);
  if (action === "seer") return submitSeer(id);
  if (action === "guard") return submitGuard(id);
  if (action === "companion") return submitCompanion(id);
  if (action === "huntress") return submitHuntress(id);
  if (action === "hunter") return shoot(id);
};

/* ===== LIVE VOTE UPDATE FOR ALL PLAYERS ===== */
socket.on("voteUpdate", summary => {
  console.log("VOTE UPDATE RECEIVED:", summary);

  alert(
    "VOTE UPDATE RECEIVED\n" +
    summary.votedCount + " / " + summary.voterCount
  );

  if (!state || state.phase !== "day") return;

  state.voteSummary = summary;
  renderGame();
});


// ===== LEAVE GAME =====
window.leaveGame = function(){
  const ok = confirm("🚪 ต้องการออกจากเกมใช่หรือไม่?");
  if(!ok) return;

  socket.emit("leaveGame", {}, (r)=>{
    if(r && r.error){
      alert(r.error);
      return;
    }

    // ล้างข้อมูล reconnect ของห้องเก่า
    localStorage.removeItem("ww_room");
    localStorage.removeItem("ww_name");

    // ล้าง state ฝั่ง Client ทั้งหมด
    state = null;
    me = null;
    counts = {};
    lastRoomCode = null;

    window.selectedPlayerId = null;
    window.playerCardAction = null;
    window.cupidSelectedIds = [];

    // ล้าง Popup ที่อาจค้าง
    document.getElementById("gameOverPopup")?.remove();
    document.getElementById("deathPopup")?.remove();
    document.getElementById("phasePopup")?.remove();

    // ล้างค่าหน้าสร้าง/เข้าห้อง
    const roomInput = document.getElementById("roomCode");
    if(roomInput) roomInput.value = "";

    // กลับหน้า Home โดยไม่ Reload
    show("home");

    const homeMsg = document.getElementById("homeMsg");
    if(homeMsg) homeMsg.textContent = "";

    console.log("OK - Left game and client state cleared");
  });
};

// ===== WOLF CHAT =====
function addWolfChatMessage(msg) {
  const box = $("wolfChatMessages");
  if (!box || !msg) return;

  const row = document.createElement("div");
  row.className = "wolf-chat-message";

  const name = document.createElement("span");
  name.className = "wolf-chat-message-name";
  name.textContent = (msg.name || "หมาป่า") + ":";

  const text = document.createElement("span");
  text.textContent = " " + (msg.message || "");

  row.appendChild(name);
  row.appendChild(text);
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function sendWolfChat() {
  const input = $("wolfChatInput");
  const msgBox = $("wolfChatMsg");
  if (!input) return;

  const message = input.value.trim();
  if (!message) return;

  socket.emit("wolfChatSend", { message }, (res) => {
    if (res?.error) {
      if (msgBox) msgBox.textContent = res.error;
      return;
    }

    input.value = "";
    if (msgBox) msgBox.textContent = "";
  });
}

$("wolfChatSendBtn")?.addEventListener("click", sendWolfChat);

$("wolfChatInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendWolfChat();
  }
});

socket.on("wolfChatMessage", (msg) => {
  addWolfChatMessage(msg);
});

// โหลดประวัติ Wolf Chat จาก Server
function loadWolfChatHistory() {
  if (!me?.canWolfChat) return;

  socket.emit("wolfChatGet", (res) => {
    if (!res?.ok) return;

    const box = $("wolfChatMessages");
    if (!box) return;

    box.innerHTML = "";
    (res.messages || []).forEach(addWolfChatMessage);
  });
}

// ===== GLOBAL CHAT CLIENT =====

function addGlobalChatMessage(msg) {
  const box = $("globalChatMessages");
  if (!box || !msg) return;

  const row = document.createElement("div");
  row.className = "wolf-chat-message";

  const name = document.createElement("span");
  name.className = "wolf-chat-message-name";
  name.textContent = (msg.name || "ผู้เล่น") + ": ";

  const text = document.createElement("span");
  text.textContent = " " + (msg.message || "");

  row.appendChild(name);
  row.appendChild(text);
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function sendGlobalChat() {
  const input = $("globalChatInput");
  const msgBox = $("globalChatMsg");
  if (!input) return;

  const message = input.value.trim();
  if (!message) return;

  socket.emit("globalChatSend", { message }, (res) => {
    if (res?.error) {
      if (msgBox) msgBox.textContent = res.error;
      return;
    }

    input.value = "";
    if (msgBox) msgBox.textContent = "";
  });
}

$("globalChatSendBtn")?.addEventListener("click", sendGlobalChat);

$("globalChatInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendGlobalChat();
  }
});

socket.on("globalChatMessage", (msg) => {
  addGlobalChatMessage(msg);
});

function loadGlobalChatHistory() {
  socket.emit("globalChatGet", (res) => {
    if (!res?.ok) return;

    const box = $("globalChatMessages");
    if (!box) return;

    box.innerHTML = "";
    (res.messages || []).forEach(addGlobalChatMessage);
  });
}

// ===== DAY / NIGHT PHASE POPUP =====
let lastPhasePopupKey = null;
let phasePopupTimer = null;

// ล็อกเพลงพื้นหลังระหว่างเสียง Popup
let phasePopupSoundActive = false;

function showPhasePopup(type, phaseNo = "") {
  const popup = document.getElementById("phasePopup");
  const img = document.getElementById("phasePopupImg");
  const title = document.getElementById("phasePopupTitle");
  const countdown = document.getElementById("phasePopupCountdown");

  if (!popup || !img || !title) return;

  const isNight = type === "night";

  img.src = isNight ? "/phase/night.png" : "/phase/day.png";
  title.textContent = isNight ? "🌙 ราตรีมาเยือน" : "🌅 อรุณรุ่งมาเยือน";

  const sound = document.getElementById(
    isNight ? "wolfHowlSound" : "roosterSound"
  );

  // หยุดเสียงของ Phase ก่อนหน้า ก่อนเริ่มเสียงใหม่
  ["wolfHowlSound", "roosterSound"].forEach(id => {
    const a = document.getElementById(id);
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
  });

  // หยุดเพลง BGM เดิมก่อนเล่นเสียง Popup
  const bgm = document.getElementById("gameBgm");
  if (bgm) {
    bgm.pause();
    bgm.currentTime = 0;
  }
  currentGameMusic = "";

  popup.classList.remove("hidden");

  // Countdown 5 → 4 → 3 → 2 → 1
  let remaining = 5;
  if (countdown) countdown.textContent = remaining;

  if (sound) {
    // ล็อกเพลงพื้นหลังไว้จนกว่าเสียง Popup จะเล่นครบทุกครั้ง
    phasePopupSoundActive = true;

    const soundFile = isNight
      ? "/sounds/wolf-howl.mp3"
      : "/sounds/rooster.mp3";

    // กลางคืน 2 รอบ / กลางวัน 3 รอบ
    const totalPlays = isNight ? 2 : 3;
    let playNo = 0;

    function playPopupSound() {
      playNo++;

      // สร้าง Audio ใหม่ทุกรอบ เพื่อให้มือถือเล่นรอบถัดไปได้แน่นอน
      const popupAudio = new Audio(soundFile);
      popupAudio.preload = "auto";

      popupAudio.onended = () => {
        if (playNo < totalPlays) {
          playPopupSound();
          return;
        }

        phasePopupSoundActive = false;
        if (state) updateGameMusic(state);
      };

      popupAudio.onerror = () => {
        console.log("PHASE POPUP AUDIO ERROR:", soundFile);
        phasePopupSoundActive = false;
        if (state) updateGameMusic(state);
      };

      popupAudio.play().catch(err => {
        console.log("PHASE POPUP PLAY ERROR:", err);
        phasePopupSoundActive = false;
        if (state) updateGameMusic(state);
      });
    }

    playPopupSound();
  }

  clearTimeout(phasePopupTimer);

  const countdownTimer = setInterval(() => {
    remaining--;

    if (remaining >= 1) {
      if (countdown) countdown.textContent = remaining;
    } else {
      clearInterval(countdownTimer);
    }
  }, 1000);

  phasePopupTimer = setTimeout(() => {
    clearInterval(countdownTimer);
    popup.classList.add("hidden");

    // ไม่หยุดเสียงตรงนี้ ปล่อยให้เสียงเล่นจนจบเอง
  }, 5000);
}

// ใช้ทดสอบจาก Console
window.testNightPopup = () => showPhasePopup("night");
window.testDayPopup = () => showPhasePopup("day");

// ===== END DAY / NIGHT PHASE POPUP =====


/* ===== ROLE CARD FLIP ===== */
window.toggleRoleCard = function(event) {
  const card = document.getElementById("roleFlipCard");
  if (!card) return;

  // ถ้ากดปุ่ม / input / Action ด้านหน้าการ์ด
  // ให้ใช้งาน Action ได้ตามปกติ ไม่พลิกการ์ด
  if (
    event.target.closest("button") ||
    event.target.closest("input") ||
    event.target.closest("textarea") ||
    event.target.closest("select")
  ) return;

  card.classList.toggle("role-card-hidden");
};
