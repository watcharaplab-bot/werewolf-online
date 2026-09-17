const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 5000;
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));

const rooms = new Map();
const MAX_PLAYERS = 15;

const ROLE_INFO = {
  Villager: { name: "ชาวบ้าน", faction: "Village", emoji: "👨‍🌾" },
  Seer: { name: "ผู้หยั่งรู้", faction: "Village", emoji: "🔮" },
  Bodyguard: { name: "ผู้คุ้มกัน", faction: "Village", emoji: "🛡️" },
  Hunter: { name: "นายพราน", faction: "Village", emoji: "🏹" },
  Cupid: { name: "กามเทพ", faction: "Village", emoji: "💘" },
  Tanner: { name: "ยาจก", faction: "Village", emoji: "🤡" },
  Diseased: { name: "ผู้ติดโรค", faction: "Village", emoji: "🦠" },
  Huntress: { name: "พรานหญิง", faction: "Village", emoji: "🏹" },
  Drunk: { name: "คนเมา", faction: "Village", emoji: "🍺" },
  Werewolf: { name: "มนุษย์หมาป่า", faction: "Werewolf", emoji: "🐺" },
  WolfCub: { name: "ลูกหมาป่า", faction: "Werewolf", emoji: "🐺" },
  DireWolf: { name: "หมาป่าโลกันตร์", faction: "Werewolf", emoji: "🐺" }
};

const isWolf = r => ["Werewolf", "WolfCub", "DireWolf"].includes(r);
const alive = p => p.alive;

function rid() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }

function newRoom(code, hostId) {
  return {
    code, hostId, players: new Map(), roleCounts: {},
    started: false, phase: "lobby", night: 0,
    actions: {}, votes: {}, deaths: [], lovers: [],
    direCompanion: null, wolfCubBonus: false,
    diseasedBlocked: false, huntressUsed: new Set(),
    lastGuardTarget: null, winner: null
  };
}

function publicPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id, name: p.name, alive: p.alive,
    isHost: p.id === room.hostId,
    roleKnown: room.started && !p.alive ? p.role : null
  }));
}

function getVoteSummary(room) {
  const tally = {};

  for (const targetId of Object.values(room.votes || {})) {
    const target = room.players.get(targetId);
    if (target && target.alive) {
      tally[targetId] = (tally[targetId] || 0) + 1;
    }
  }

  const alivePlayers = [...room.players.values()].filter(p => p.alive);

  return {
    tally,
    votedCount: Object.keys(room.votes || {}).length,
    voterCount: alivePlayers.length
  };
}

function getWolfTeamFor(room, viewer) {
  // ผู้เล่นปกติที่เป็นฝ่ายหมาป่า
  const viewerIsWolf = isWolf(viewer.role);

  // Drunk ที่ได้บทจริงเป็นหมาป่า จะรู้ตัวตั้งแต่คืนที่ 2
  const viewerIsDrunkWolf =
    viewer.role === "Drunk" &&
    isWolf(viewer.trueRole) &&
    room.night >= 2;

  // คนที่ไม่ใช่ฝ่ายหมาป่า จะไม่ได้รับรายชื่อ
  if (!viewerIsWolf && !viewerIsDrunkWolf) return [];

  return [...room.players.values()]
    .filter(player => {
      // หมาป่าปกติ เห็นได้ทันที
      if (isWolf(player.role)) return true;

      // Drunk ที่ได้บทหมาป่า ซ่อนในคืนแรก
      // และเปิดเผยต่อทีมตั้งแต่คืนที่ 2
      if (
        player.role === "Drunk" &&
        isWolf(player.trueRole) &&
        room.night >= 2
      ) {
        return true;
      }

      return false;
    })
    .map(player => ({
      id: player.id,
      name: player.name,
      alive: player.alive
    }));
}

function sendState(room) {
  for (const p of room.players.values()) {
    const me = {
      id: p.id, name: p.name, alive: p.alive, role: p.role,
      trueRole: p.trueRole || null, faction: ROLE_INFO[p.role]?.faction,
      emoji: ROLE_INFO[p.role]?.emoji, night: room.night
    };
    io.to(p.id).emit("state", {
      room: room.code, hostId: room.hostId, started: room.started,
      phase: room.phase, night: room.night, nightEndsAt: room.nightEndsAt || null, dayEndsAt: room.dayEndsAt || null, players: publicPlayers(room),
        me,
        lastGuardTarget: p.role === "Bodyguard" ? (room.lastGuardTarget || null) : null,
          huntressUsed: p.role === "Huntress" ? room.huntressUsed.has(p.id) : false,
        wolfTeam: getWolfTeamFor(room, p),
        lovers: room.lovers.includes(p.id) ? room.lovers : [],
        cupidLovers: p.role === "Cupid" ? room.lovers : [],
      winner: room.winner, pendingHunter: room.pendingHunter || null,
      memorialDeaths: room.memorialDeaths || [], memorialEndsAt: room.memorialEndsAt || null,
      message: room.message || "",
        voteSummary: room.phase === "day" ? getVoteSummary(room) : null,
        wolfVoteSummary:
          room.phase === "night" &&
          (
            isWolf(p.role) ||
            (
              p.role === "Drunk" &&
              isWolf(p.trueRole) &&
              room.night >= 2
            )
          )
            ? getWolfVoteSummary(room)
            : null
    });
  }
}

function broadcast(room, event, data) {
  io.to(room.code).emit(event, data);
}

function aliveById(room, id) {
  const p = room.players.get(id);
  return p && p.alive ? p : null;
}

function livingCount(room, faction) {
  return [...room.players.values()].filter(p => p.alive && (!faction || ROLE_INFO[p.role]?.faction === faction)).length;
}

function checkWinner(room) {
  if (room.winner) return true;
  const alivePlayers = [...room.players.values()].filter(alive);
  const village = alivePlayers.filter(p => ROLE_INFO[p.role]?.faction === "Village").length;
  const wolves = alivePlayers.filter(p => isWolf(p.role)).length;

  if (alivePlayers.some(p => p.role === "Tanner" && p.tannerWon)) {
    room.winner = "Tanner";
  } else if (wolves === 0) {
    room.winner = "Village";
  } else if (wolves >= village) {
    room.winner = "Werewolf";
  }
  return !!room.winner;
}

function startMemorial(room, deadIds) {
  room.memorialDeaths = deadIds.map(id => room.players.get(id)?.name).filter(Boolean);
  room.memorialEndsAt = Date.now() + 20000;
}
function kill(room, id, reason = "") {
  const p = room.players.get(id);
  console.log("LOVE DEBUG:", {killedId:id, lovers:room.lovers, players:[...room.players.values()].map(p=>({id:p.id,name:p.name,alive:p.alive}))});
  if (!p || !p.alive) return [];
  p.alive = false;
  p.deathReason = reason;
  if (p.role === "Hunter") room.pendingHunter = id;
  const killed = [id];

  // Lover death chain
  const idx = room.lovers.indexOf(id);
  if (idx >= 0) {
    const lover = room.lovers[idx === 0 ? 1 : 0];
    const lp = room.players.get(lover);
    if (lp && lp.alive) {
      lp.alive = false;
      lp.deathReason = "Lover";
      killed.push(lover);
    if (lp.role === "Hunter") room.pendingHunter = lover;
    }
  }

  return killed;
}

function resetRound(room) {
  room.started = false; room.phase = "lobby"; room.night = 0;
  room.actions = {}; room.votes = {}; room.deaths = []; room.lovers = [];
  room.direCompanion = null; room.wolfCubBonus = false;
  room.diseasedBlocked = false; room.huntressUsed = new Set();
  room.lastGuardTarget = null; room.winner = null; room.message = "";
  for (const p of room.players.values()) {
    p.alive = true; p.role = null; p.trueRole = null; p.tannerWon = false;
    p.deathReason = null;
  }
}

function assignRoles(room) {
  const roles = [];
  for (const [r, n] of Object.entries(room.roleCounts)) {
    for (let i = 0; i < n; i++) roles.push(r);
  }
  if (roles.length !== room.players.size) return false;
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  const ps = [...room.players.values()];
  ps.forEach((p, i) => {
    p.role = roles[i];
    p.trueRole = p.role;
  });

  // Drunk: secretly determine true role from a random role card.
  const drunk = ps.find(p => p.role === "Drunk");
  if (drunk) {
    const pool = ["Werewolf", "Villager"];
    const special = roles.filter(r => !["Drunk"].includes(r))[Math.floor(Math.random() * Math.max(1, roles.length - 1))];
    if (special) pool.push(special);
    drunk.trueRole = pool[Math.floor(Math.random() * pool.length)];
  }
  return true;
}

function startNight(room) {
  room.night++;
  room.phase = "night";
  room.actions = {};
  room.votes = {};

  // ไม่มีเวลาจำกัดในช่วงกลางคืน
  room.nightEndsAt = null;
  room.nightDeathStart = room.deaths.length;

  room.message = `🌙 คืนที่ ${room.night} — ผู้มีพลัง กรุณาเลือกการกระทำของคุณ`;

  sendState(room);

  broadcast(room, "phase", {
    phase: "night",
    night: room.night,
    message: room.message
  });
}

function availableActions(room, p) {
  if (!p.alive || room.phase !== "night") return [];
  const candidates = [...room.players.values()].filter(x => x.alive && x.id !== p.id);
  const actions = [];
  if (p.role === "Seer") actions.push("seer");
  if (p.role === "Bodyguard") actions.push("guard");
  if (p.role === "Cupid" && room.night === 1) actions.push("cupid");
    if (
      isWolf(p.role) ||
      (
        p.role === "Drunk" &&
        isWolf(p.trueRole) &&
        room.night >= 2
      )
    ) actions.push("wolf");
  if (p.role === "Huntress" && !room.huntressUsed.has(p.id)) actions.push("huntress");
  if (p.role === "DireWolf" && room.night === 1) actions.push("companion");
  return actions;
}

function resolveNight(room) {
  const kills = new Set();
  const notes = [];

  // Cupid first night
  const cupid = [...room.players.values()].find(p => p.alive && p.role === "Cupid");
  if (cupid && room.night === 1 && room.actions[cupid.id]?.type === "cupid") {
    const a = aliveById(room, room.actions[cupid.id].a);
    const b = aliveById(room, room.actions[cupid.id].b);
    if (a && b && a.id !== b.id) {
      room.lovers = [a.id, b.id];
      notes.push("💘 กามเทพได้ผูกคู่รัก 2 คนแล้ว");
    }
  }

  // Dire Wolf companion
  const dire = [...room.players.values()].find(p => p.alive && p.role === "DireWolf");
  if (dire && room.night === 1 && room.actions[dire.id]?.type === "companion") {
    const target = aliveById(room, room.actions[dire.id].target);
    if (target && target.id !== dire.id) room.direCompanion = target.id;
  }

  // Guard
  let guardTarget = null;
  const guard = [...room.players.values()].find(p => p.alive && p.role === "Bodyguard");
  if (guard && room.actions[guard.id]?.type === "guard") {
    const target = aliveById(room, room.actions[guard.id].target);
    if (target && target.id !== room.lastGuardTarget) {
      guardTarget = target.id;
      room.lastGuardTarget = target.id;
    }
  }

  // Werewolf target(s) - ต้องเลือกเหยื่อตรงกันทั้งทีม
  const wolfSummary = getWolfVoteSummary(room);
  let wolfTargets = [];

  if (room.diseasedBlocked) {
    notes.push("🦠 คืนนี้หมาป่าไม่สามารถสังหารได้ เพราะฤทธิ์ของผู้ติดโรค");
    room.diseasedBlocked = false;

  } else if (wolfSummary.unanimous && wolfSummary.targetId) {

    // ปกติฆ่าเป้าหมายที่ทีมตกลงตรงกัน
    wolfTargets = [wolfSummary.targetId];

    // WolfCub bonus เก็บไว้ก่อน
    // ระบบ 2 kills จะจัดการแยกภายหลัง
    if (room.wolfCubBonus) {
      room.wolfCubBonus = false;
    }
  }

  for (const target of wolfTargets) {
    if (target !== guardTarget) {
      kills.add(target);
    } else {
      notes.push("🛡️ ผู้คุ้มกันช่วยปกป้องเหยื่อไว้ได้");
    }
  }

  // Huntress
  for (const p of room.players.values()) {
    const a = room.actions[p.id];
    if (p.alive && p.role === "Huntress" && a?.type === "huntress" && a.target) {
      const t = aliveById(room, a.target);
      if (t && t.id !== p.id) {
        kills.add(t.id);
        room.huntressUsed.add(p.id);
        notes.push("🏹 พรานหญิงใช้ความสามารถแล้ว");
      }
    }
  }

  // Resolve deaths and special triggers
  for (const id of kills) {
    const p = room.players.get(id);
    if (!p || !p.alive) continue;
    const beforeRole = p.role;
    const newlyDead = kill(room, id, "Night");
    room.deaths.push(...newlyDead);
    if (beforeRole === "Diseased") {
      room.diseasedBlocked = true;
      notes.push("🦠 หมาป่าฆ่าผู้ติดโรค — คืนถัดไปหมาป่าจะป่วยและฆ่าใครไม่ได้");
    }
    if (beforeRole === "WolfCub") {
      room.wolfCubBonus = true;
      notes.push("🐺 ลูกหมาป่าตาย — คืนถัดไปหมาป่าจะฆ่าได้ 2 คน");
    }
  }

  // Dire companion rule
  if (room.direCompanion) {
    const companion = room.players.get(room.direCompanion);
    const dw = [...room.players.values()].find(p => p.role === "DireWolf");
    if (companion && !companion.alive && dw?.alive) {
      const extra = kill(room, dw.id, "Dire Wolf companion");
      room.deaths.push(...extra);
      notes.push("🐺 สหายของหมาป่าโลกันตร์เสียชีวิต — หมาป่าโลกันตร์เสียชีวิตตาม");
    }
  }

  // Drunk gets revealed from night 2 onward
  if (room.night >= 2) {
    const drunk = [...room.players.values()].find(p => p.role === "Drunk");
    if (drunk) drunk.role = drunk.trueRole;
  }

  const nightDead = room.deaths.slice(room.nightDeathStart || 0);
  const nextAfterMemorial = room.pendingHunter ? "hunter" : (checkWinner(room) ? "gameover" : "day");
  if (nightDead.length > 0) {
    room.afterMemorialPhase = nextAfterMemorial;
    startMemorial(room, nightDead);
    room.phase = "memorial";
    room.message = "🕯️ ขอร่วมไว้อาลัยแด่ผู้จากไป";
    sendState(room);
    return;
  }
  if (!room.pendingHunter && checkWinner(room)) {
    room.phase = "gameover";
    room.message = notes.join("\n") || "🌙 จบคืน";
  } else if (room.pendingHunter) {
    room.phase = "hunter";
    room.message = "🏹 นายพรานเสียชีวิต - เลือกคนที่จะยิง";
  } else if (!room.pendingHunter) {
    room.phase = "day";
    room.votes = {};
    room.dayEndsAt = null;

    room.message = notes.join("\n") || "☀️ เช้าวันใหม่ — โปรดพูดคุยและโหวต";
  }
  sendState(room);
  broadcast(room, "nightResult", {
    phase: room.phase, deaths: room.deaths.slice(-10),
    notes, message: room.message
  });
}

function afterNightMemorial(room) {
  const next = room.afterMemorialPhase || "day";

  room.memorialDeaths = [];
  room.memorialEndsAt = null;
  room.afterMemorialPhase = null;

  if (next === "hunter") {
    room.phase = "hunter";
    room.message = "🏹 นายพรานเสียชีวิต - เลือกคนที่จะยิง";
    sendState(room);
    return;
  }

  if (next === "gameover") {
    room.phase = "gameover";
    sendState(room);
    return;
  }

  room.phase = "day";
  room.votes = {};
  room.dayEndsAt = null;
  room.message = "☀️ เช้าวันใหม่ — โปรดพูดคุยและโหวต";


  sendState(room);
}

function getWolfVoteSummary(room) {
  // สมาชิกทีมหมาป่าที่ต้องร่วมเลือกเหยื่อในคืนนี้
  const wolves = [...room.players.values()].filter(p =>
    p.alive &&
    (
      isWolf(p.role) ||
      (
        p.role === "Drunk" &&
        isWolf(p.trueRole) &&
        room.night >= 2
      )
    )
  );

  const choices = wolves.map(w => {
    const action = room.actions[w.id];
    const target = action?.type === "wolf"
      ? room.players.get(action.target)
      : null;

    return {
      id: w.id,
      name: w.name,
      targetId: target?.id || null,
      targetName: target?.name || null
    };
  });

  const selected = choices.filter(x => x.targetId);

  // ต้องเลือกครบทุกตัว และเป้าหมายต้องเป็นคนเดียวกัน
  const unanimous =
    wolves.length > 0 &&
    selected.length === wolves.length &&
    new Set(selected.map(x => x.targetId)).size === 1;

  return {
    choices,
    selectedCount: selected.length,
    wolfCount: wolves.length,
    unanimous,
    targetId: unanimous ? selected[0].targetId : null,
    targetName: unanimous ? selected[0].targetName : null
  };
}

function allNightActionsDone(room) {
  const needed = [...room.players.values()].filter(
    p => p.alive && availableActions(room, p).length
  );

  // ทุกคนที่มี Action ต้องทำ Action ก่อน
  if (!needed.every(p => room.actions[p.id])) {
    return false;
  }

  // ถ้ามีหมาป่ามากกว่า 1 ตัว
  // หมาป่าทุกตัวต้องเลือกเหยื่อคนเดียวกัน
  const wolfSummary = getWolfVoteSummary(room);

  if (wolfSummary.wolfCount > 0 && !wolfSummary.unanimous) {
    return false;
  }

  return true;
}

io.on("connection", socket => {
  // Used by the browser to detect a stale room after restart/republish.
  socket.on("checkRoom", ({ code }, cb) => {
    code = String(code || "").trim().toUpperCase();
    cb({ ok: rooms.has(code) });
  });

  socket.on("createRoom", ({ name }, cb) => {
    name = String(name || "").trim().slice(0, 24);
    if (!name) return cb({ error: "กรุณาใส่ชื่อผู้เล่น" });
    let code; do { code = rid(); } while (rooms.has(code));
    const room = newRoom(code, socket.id);
    rooms.set(code, room);
    room.players.set(socket.id, { id: socket.id, name, alive: true });
    socket.join(code);
    cb({ ok: true, code });
    sendState(room);
  });

  socket.on("joinRoom", ({ code, name }, cb) => {
    code = String(code || "").trim().toUpperCase();
    name = String(name || "").trim().slice(0, 24);

    const room = rooms.get(code);
    if (!room) return cb({ error: "ไม่พบห้องนี้" });
    if (!name) return cb({ error: "กรุณาใส่ชื่อผู้เล่น" });

    // หา Player ชื่อเดิมที่หลุดและกำลังรอ reconnect
    const oldEntry = [...room.players.entries()].find(
      ([id, p]) => p.name.toLowerCase() === name.toLowerCase()
    );

    if (oldEntry) {
      const [oldId, oldPlayer] = oldEntry;

      // ถ้า socket เดิมยัง online อยู่ ไม่ให้ชื่อซ้ำ
      if (oldId !== socket.id && io.sockets.sockets.has(oldId)) {
        return cb({ error: "ชื่อผู้เล่นนี้มีอยู่ในห้องแล้ว" });
      }

      // ย้ายข้อมูล Player เดิมมายัง Socket ใหม่
      room.players.delete(oldId);

      oldPlayer.id = socket.id;
      room.players.set(socket.id, oldPlayer);

      // ถ้าคนที่กลับมาเป็น HOST ให้คืน HOST
      if (room.hostId === oldId) {
        room.hostId = socket.id;
      }

      socket.join(code);
      cb({ ok: true, code, reconnected: true });
      sendState(room);
      return;
    }

    // คนใหม่เข้าไม่ได้หลังเกมเริ่ม
    if (room.started)
      return cb({ error: "เกมเริ่มแล้ว ไม่สามารถเข้าร่วมรอบนี้ได้" });

    if (room.players.size >= MAX_PLAYERS)
      return cb({ error: "ห้องเต็มแล้ว" });

    room.players.set(socket.id, {
      id: socket.id,
      name,
      alive: true
    });

    socket.join(code);
    cb({ ok: true, code });
    sendState(room);
  });

  socket.on("setRoles", ({ roleCounts }, cb) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room || room.hostId !== socket.id) return cb({ error: "เฉพาะ HOST เท่านั้น" });
    if (room.started) return cb({ error: "เกมเริ่มแล้ว" });
    const cleaned = {};
    for (const [role, n] of Object.entries(roleCounts || {})) {
      if (ROLE_INFO[role]) {
        const count = Math.max(0, Math.min(15, Number(n) || 0));
        if (count) cleaned[role] = count;
      }
    }
    const total = Object.values(cleaned).reduce((a,b)=>a+b,0);
    if (total !== room.players.size) return cb({ error: `จำนวน Role (${total}) ต้องเท่ากับจำนวนผู้เล่น (${room.players.size})` });
    room.roleCounts = cleaned;
    cb({ ok: true });
    sendState(room);
  });

  socket.on("startGame", ({ roleCounts }, cb) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room || room.hostId !== socket.id) return cb({ error: "เฉพาะ HOST เท่านั้น" });
    const cleaned = {};
    for (const [role, n] of Object.entries(roleCounts || {})) {
      if (ROLE_INFO[role]) cleaned[role] = Math.max(0, Math.min(15, Number(n) || 0));
    }
    const total = Object.values(cleaned).reduce((a,b)=>a+b,0);
    if (room.players.size < 2) return cb({ error: "ต้องมีผู้เล่นอย่างน้อย 2 คน" });
    if (total !== room.players.size) return cb({ error: `จำนวน Role (${total}) ต้องเท่ากับผู้เล่น (${room.players.size})` });
    room.roleCounts = cleaned;
    room.started = true;
    room.winner = null;
    assignRoles(room);
    startNight(room);
    cb({ ok: true });
  });

  socket.on("nightAction", ({ type, target, a, b }, cb) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    const p = room?.players.get(socket.id);
    if (!room || !p) return cb({ error: "ไม่พบผู้เล่น" });
    if (room.phase !== "night" || !p.alive) return cb({ error: "ตอนนี้ไม่สามารถทำ Action ได้" });

    const allowed = availableActions(room, p);
    if (!allowed.includes(type)) return cb({ error: "คุณไม่มีความสามารถนี้ในตอนนี้" });

    if (type === "cupid") {
      if (a === b) return cb({ error: "ต้องเลือกคนละ 2 คน" });
      if (!aliveById(room,a) || !aliveById(room,b)) return cb({ error: "เป้าหมายไม่ถูกต้อง" });
    } else if (type === "companion" || type === "wolf" || type === "seer" || type === "guard" || type === "huntress") {
      const t = aliveById(room, target);
      if (!t) return cb({ error: "เป้าหมายไม่ถูกต้อง" });

      // Guard สามารถป้องกันตัวเองได้
      // Action อื่นยังคงห้ามเลือกตัวเอง
      if (type !== "guard" && t.id === p.id)
        return cb({ error: "เป้าหมายไม่ถูกต้อง" });
      if (
        type === "wolf" &&
        (
          isWolf(t.role) ||
          (
            t.role === "Drunk" &&
            isWolf(t.trueRole) &&
            room.night >= 2
          )
        )
      ) return cb({ error: "หมาป่าเลือกฆ่าสมาชิกทีมหมาป่าด้วยกันไม่ได้" });
      if (type === "guard" && target === room.lastGuardTarget) return cb({ error: "ห้ามป้องกันคนเดิมติดต่อกัน" });
    }

    // Seer ตรวจได้เพียง 1 คนต่อคืน
    // ถ้าส่งผลตรวจไปแล้ว ห้ามเปลี่ยนเป้าหมายหรือตรวจซ้ำในคืนเดียวกัน
    if (type === "seer" && room.actions[p.id]?.type === "seer") {
      return cb({ error: "Seer ตรวจได้เพียง 1 คนต่อคืน" });
    }

    room.actions[p.id] = { type, target, a, b };

      // Cupid: บันทึกคู่รักทันทีหลังยืนยัน
      if (type === "cupid") {
        room.lovers = [a, b];
      }

    if (type === "seer") {
      const t = room.players.get(target);
      let seen = t?.role;

      // คนเมา: คืนแรก Seer ยังไม่เห็นบทจริง
      // ตั้งแต่คืนที่ 2 จึงตรวจตาม trueRole
      if (t?.role === "Drunk") {
        seen = room.night >= 2 ? t.trueRole : "Drunk";
      }

      socket.emit("privateResult", {
        type: "seer",
        target: t.name,
        isWolf: isWolf(seen)
      });
    }

    if (type === "huntress") {
      room.huntressUsed.add(p.id);
    }

    cb({ ok: true });

    if (allNightActionsDone(room)) resolveNight(room);
    else sendState(room);
  });

  
function finishDayVote(room) {
  // ป้องกันการสรุปซ้ำ
  if (!room || room.phase !== "day") return;

  const tally = {};

  // นับเฉพาะ Vote ที่มีอยู่
  for (const targetId of Object.values(room.votes || {})) {
    const target = aliveById(room, targetId);
    if (target) {
      tally[targetId] = (tally[targetId] || 0) + 1;
    }
  }

  const scores = Object.values(tally);

  // มีคนโหวตอย่างน้อย 1 คน
  if (scores.length > 0) {
    const max = Math.max(...scores);

    const winners = Object.entries(tally)
      .filter(([, n]) => n === max)
      .map(([id]) => id);

    // ประหารเฉพาะกรณีคะแนนสูงสุดมีคนเดียว
    if (winners.length === 1) {
      const out = room.players.get(winners[0]);

      if (out && out.alive) {
        if (out.role === "Tanner") {
          out.tannerWon = true;
          room.winner = "Tanner";
        } else {
          const before = out.role;
          const ds = kill(room, out.id, "Vote");
          room.deaths.push(...ds);

          if (before === "WolfCub") room.wolfCubBonus = true;
        for (const deadId of ds) { const deadPlayer = room.players.get(deadId); if (deadPlayer?.role === "Hunter") room.pendingHunter = deadId; if (deadPlayer?.role === "WolfCub") room.wolfCubBonus = true; }
        }
      }
    }
  }

  room.votes = {};
  room.dayEndsAt = null;

  if (!room.winner && room.pendingHunter) {
    console.log("HUNTER SERVER DEBUG", {
      pendingHunter: room.pendingHunter,
      phase: room.phase,
      players: [...room.players.values()].map(p => ({
        id:p.id, name:p.name, role:p.role, alive:p.alive
      }))
    });
    room.phase = "hunter";
    room.message = "🏹 นายพรานเสียชีวิต – เลือกคนที่จะยิง";
    sendState(room);
  } else if (checkWinner(room)) {
    room.phase = "gameover";
    sendState(room);
  } else {
    startNight(room);
  }
}

socket.on("vote", ({ target }, cb) => {
  const room = [...rooms.values()].find(r => r.players.has(socket.id));
  const p = room?.players.get(socket.id);

  if (!room || !p)
    return cb({ error: "ไม่พบผู้เล่น" });

  console.log("VOTE DEBUG:", {name:p.name, alive:p.alive, phase:room.phase, socket:socket.id});
  if (room.phase !== "day" || !p.alive)
    return cb({ error: "ตอนนี้ไม่สามารถโหวตได้" });

  // หมดเวลาแล้ว ไม่รับ Vote เพิ่ม
  if (room.dayEndsAt && Date.now() >= room.dayEndsAt)
    return cb({ error: "หมดเวลาโหวตแล้ว" });

  const t = aliveById(room, target);

  if (!t || t.id === p.id)
    return cb({ error: "โหวตเป้าหมายไม่ถูกต้อง" });

  // ผู้เล่นสามารถเปลี่ยน Vote ได้จนกว่าทุกคนจะ Vote ครบ
  room.votes[p.id] = target;

  cb({ ok: true });
    // ส่งผลโหวตล่าสุดให้ผู้เล่นทุกคนทันที
    sendState(room);

  const voters = [...room.players.values()].filter(alive);

  // ทุกคน Vote ครบ → สรุปทันที
  if (voters.every(v => room.votes[v.id])) {
    finishDayVote(room);
    return;
  }

  sendState(room);
});

socket.on("hunterShot", ({ target }, cb) => {
  const room = [...rooms.values()].find(r => r.players.has(socket.id));

  if (!room || room.phase !== "hunter" || room.pendingHunter !== socket.id)
    return cb({ error: "ไม่มีสิทธิ์" });

  const t = aliveById(room, target);
  if (!t || t.id === socket.id)
    return cb({ error: "เป้าหมายไม่ถูกต้อง" });

  const ds = kill(room, t.id, "Hunter");
  room.deaths.push(...ds);
  room.pendingHunter = null;

  cb({ ok: true });

  if (checkWinner(room)) {
    room.phase = "gameover";
    room.dayEndsAt = null;
    sendState(room);
    return;
  }

  room.phase = "day";
  room.votes = {};
  room.dayEndsAt = null;
  room.message = "☀️ นายพรานยิงแล้ว — เข้าสู่ช่วงพูดคุยและโหวต";


  sendState(room);
});

socket.on("continueMemorial", cb => {
  const room = [...rooms.values()].find(r => r.players.has(socket.id));

  if (!room)
    return cb({ error: "ไม่พบห้อง" });

  if (room.hostId !== socket.id)
    return cb({ error: "เฉพาะ HOST เท่านั้น" });

  if (room.phase !== "memorial")
    return cb({ error: "ตอนนี้ไม่ได้อยู่ในช่วงไว้อาลัย" });

  cb({ ok: true });
  afterNightMemorial(room);
});

socket.on("newRound", cb => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room || room.hostId !== socket.id) return cb({ error: "เฉพาะ HOST เท่านั้น" });
    resetRound(room);
    cb({ ok: true });
    sendState(room);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      if (!room.players.has(socket.id)) continue;

      const oldSocketId = socket.id;

      setTimeout(() => {
        const r = rooms.get(code);
        if (!r) return;

        // ถ้ายังเป็นผู้เล่นคนเดิมและยังไม่ได้ reconnect ให้ลบหลัง 3 นาที
        if (r.players.has(oldSocketId)) {
          r.players.delete(oldSocketId);

          if (r.hostId === oldSocketId) {
            const next = r.players.values().next().value;
            if (next) r.hostId = next.id;
          }

          if (r.players.size === 0) {
            rooms.delete(code);
          } else {
            sendState(r);
          }
        }
      }, 180000);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Werewolf server running on http://localhost:${PORT}`));
