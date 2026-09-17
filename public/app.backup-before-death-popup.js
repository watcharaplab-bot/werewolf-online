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

socket.on("state",s=>{
  state=s; me=s.me;
  if(!s.started){ renderLobby(); show("lobby"); }
  else { renderGame(); show("game"); }
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
  socket.emit("startGame",{roleCounts:counts},r=>{if(!r.ok)err("hostMsg",r.error)});
};

function renderMemorial(){
  $("phaseTitle").textContent="🕯️ ไว้อาลัย";
  $("gameMsg").textContent="ขอร่วมไว้อาลัยแด่ผู้จากไป";

  $("actions").innerHTML=(state.memorialDeaths||[])
    .map(name=>`<div class="notice">🕯️ <b>${name}</b></div>`)
    .join("");

  if(state.hostId===me.id){
    $("actions").innerHTML +=
      '<button class="primary full" onclick="continueMemorial()">ดำเนินเกมต่อ ➜</button>';
  }
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
        <div class="roleTitle">${roles[me.role]?.[1]||me.role}</div>
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
  if(state.phase==="gameover"){renderGameOver();return}
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
    $("actions").innerHTML='<div class="notice">💘 เลือกคู่รัก 2 คน</div><div id="cup"></div><button class="primary full" onclick="submitCupid()">ยืนยันคู่รัก</button>';
    window.cupA=null;window.cupB=null;
    $("cup").innerHTML=candidates().map(p=>`<button class="target" id="cup-${p.id}" onclick="pickCup('${p.id}')">${p.name}</button>`).join("");return;
  }
  if(me.role==="DireWolf"&&state.night===1){
    $("actionTitle").textContent="🐺 เลือก Companion";
    setupPlayerCardSelection("companion","เลือก Companion จากรายชื่อผู้เล่น","✓ ยืนยัน Companion");return;
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
      $("actionTitle").textContent="🐺 เลือกเหยื่อ";

      setupPlayerCardSelection(
        "wolf",
        "เลือกเหยื่อจากรายชื่อผู้เล่น",
        "✓ ยืนยันเป้าหมาย"
      );

      // แสดงว่าเพื่อนหมาป่าแต่ละคนเลือกใคร
      $("actions").insertAdjacentHTML("afterbegin", wolfVoteHtml);
      return;
    }
  if(me.role==="Seer"){
    $("actionTitle").textContent="🔮 ตรวจสอบ 1 คน";
    setupPlayerCardSelection("seer","เลือกผู้เล่นที่ต้องการตรวจสอบ","✓ ยืนยันการตรวจ");return;
  }
  if(me.role==="Bodyguard"){
    $("actionTitle").textContent="🛡️ ปกป้อง 1 คน";
    setupPlayerCardSelection("guard","เลือกผู้เล่นที่ต้องการปกป้อง","✓ ยืนยันการปกป้อง");return;
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
  setupPlayerCardSelection("vote","เลือกผู้เล่นที่ต้องการโหวตออก","✓ ยืนยันการโหวต");
}
window.votePlayer=id=>socket.emit("vote",{target:id},r=>{if(!r.ok)alert(r.error);else $("actions").innerHTML='<div class="notice">🗳️ โหวตแล้ว รอผู้เล่นคนอื่น...</div>'});

function renderHunter(){ console.log("HUNTER DEBUG",{me:me,pendingHunter:state.pendingHunter,phase:state.phase,players:state.players});
  $("actionTitle").textContent="🏹 นายพราน";
  $("actions").innerHTML="";

  if(!me || state.pendingHunter !== me.id){
    $("actions").innerHTML='<div class="notice">🏹 รอนายพรานเลือกเป้าหมาย...</div>';
    return;
  }

  setupPlayerCardSelection("hunter","เลือกผู้เล่นที่นายพรานต้องการยิง","🏹 ยืนยันการยิง");
}
window.shoot=id=>socket.emit("hunterShot",{target:id},r=>{if(!r.ok)alert(r.error)});

function renderGameOver(){
  const map={Village:"🏆 ฝ่ายชาวบ้านชนะ",Werewolf:"🐺 ฝ่ายหมาป่าชนะ",Tanner:"🤡 ยาจกชนะทันที"};
  $("actionTitle").textContent="GAME OVER";
  $("actions").innerHTML=`<div class="winner">${map[state.winner]||state.winner}</div>${state.hostId===me.id?'<button class="primary full" onclick="newRound()">🔄 เล่นรอบใหม่</button>':''}`;
}
window.newRound=()=>socket.emit("newRound",r=>{if(!r.ok)alert(r.error)});
socket.on("privateResult",r=>{
  if(r.type==="seer"){
    $("private").innerHTML=`<div class="notice">🔮 ผลการตรวจ<br><br>${r.target}<br><b>${r.isWolf?"🐺 ฝ่ายหมาป่า":"🏡 ฝ่ายชาวบ้าน"}</b></div>`;
  }
});
socket.on("nightResult",r=>{ $("gameMsg").textContent=r.message||""; });


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

window.setupPlayerCardSelection = function(actionType, title, confirmText) {
  window.selectedPlayerId = null;
  window.playerCardAction = actionType;

  // Bodyguard เลือกผู้เล่นที่ยังมีชีวิตทั้งหมด รวมตัวเอง
  // Action อื่นใช้กติกาเดิม
  const allowed = actionType === "guard"
    ? state.players.filter(p => p.alive).map(p => p.id)
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

