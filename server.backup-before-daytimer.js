const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 5000;
app.use(express.static(path.join(__dirname, "public")));

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
      me, lovers: room.lovers.includes(p.id) ? room.lovers : [],
      winner: room.winner,
      message: room.message || ""
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

function kill(room, id, reason = "") {
  const p = room.players.get(id);
  if (!p || !p.alive) return [];
  p.alive = false;
  p.deathReason = reason;
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

  // กลางคืนมีเวลา 30 วินาที
  room.nightEndsAt = Date.now() + 30000;
  const thisNight = room.night;

  room.message = `🌙 คืนที่ ${room.night} — ผู้มีพลัง กรุณาเลือกการกระทำของคุณ`;

  sendState(room);

  broadcast(room, "phase", {
    phase: "night",
    night: room.night,
    message: room.message,
    endsAt: room.nightEndsAt
  });

  // ครบ 30 วินาที จบกลางคืนอัตโนมัติ
  setTimeout(() => {
    if (
      room.phase === "night" &&
      room.night === thisNight
    ) {
      resolveNight(room);
    }
  }, 30000);
}

function availableActions(room, p) {
  if (!p.alive || room.phase !== "night") return [];
  const candidates = [...room.players.values()].filter(x => x.alive && x.id !== p.id);
  const actions = [];
  if (p.role === "Seer") actions.push("seer");
  if (p.role === "Bodyguard") actions.push("guard");
  if (p.role === "Cupid" && room.night === 1) actions.push("cupid");
  if (p.role === "Werewolf" || p.role === "WolfCub" || p.role === "DireWolf") actions.push("wolf");
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
    if (target && target.id !== guard.id && target.id !== room.lastGuardTarget) {
      guardTarget = target.id;
      room.lastGuardTarget = target.id;
    }
  }

  // Werewolf target(s)
  const wolves = [...room.players.values()].filter(p => p.alive && isWolf(p.role));
  const wolfVotes = {};
  for (const w of wolves) {
    const a = room.actions[w.id];
    if (a?.type === "wolf") {
      const t = aliveById(room, a.target);
      if (t && !isWolf(t.role)) wolfVotes[t.id] = (wolfVotes[t.id] || 0) + 1;
    }
  }
  let wolfTargets = Object.entries(wolfVotes).sort((a,b) => b[1]-a[1]).map(x => x[0]);
  if (room.diseasedBlocked) {
    notes.push("🦠 คืนนี้หมาป่าไม่สามารถสังหารได้ เพราะฤทธิ์ของผู้ติดโรค");
    wolfTargets = [];
    room.diseasedBlocked = false;
  } else if (room.wolfCubBonus) {
    wolfTargets = wolfTargets.slice(0, 2);
    room.wolfCubBonus = false;
  } else {
    wolfTargets = wolfTargets.slice(0, 1);
  }

  for (const target of wolfTargets) {
    if (target !== guardTarget) kills.add(target);
    else notes.push("🛡️ ผู้คุ้มกันช่วยปกป้องเหยื่อไว้ได้");
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

  if (checkWinner(room)) {
    room.phase = "gameover";
    room.message = notes.join("\n") || "🌙 จบคืน";
  } else {
    room.phase = "day";
    room.votes = {};
    room.dayEndsAt = Date.now() + 180000;
    room.message = notes.join("\n") || "☀️ เช้าวันใหม่ — โปรดพูดคุยและโหวต";
  }
  sendState(room);
  broadcast(room, "nightResult", {
    phase: room.phase, deaths: room.deaths.slice(-10),
    notes, message: room.message
  });
}

function allNightActionsDone(room) {
  const needed = [...room.players.values()].filter(p => p.alive && availableActions(room, p).length);
  return needed.every(p => room.actions[p.id]);
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
      if (!t || t.id === p.id) return cb({ error: "เป้าหมายไม่ถูกต้อง" });
      if (type === "wolf" && isWolf(t.role)) return cb({ error: "หมาป่าเลือกฆ่าหมาป่าด้วยกันไม่ได้" });
      if (type === "guard" && target === room.lastGuardTarget) return cb({ error: "ห้ามป้องกันคนเดิมติดต่อกัน" });
    }

    room.actions[p.id] = { type, target, a, b };

    if (type === "seer") {
      const t = room.players.get(target);
      let seen = t?.role;
      if (t?.role === "Drunk") seen = t.trueRole;
      socket.emit("privateResult", { type: "seer", target: t.name, role: seen, isWolf: isWolf(seen) });
    }

    if (type === "huntress") {
      room.huntressUsed.add(p.id);
    }

    cb({ ok: true });

    if (allNightActionsDone(room)) resolveNight(room);
    else sendState(room);
  });

  socket.on("vote", ({ target }, cb) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    const p = room?.players.get(socket.id);
    if (!room || !p) return cb({ error: "ไม่พบผู้เล่น" });
    if (room.phase !== "day" || !p.alive) return cb({ error: "ตอนนี้ไม่สามารถโหวตได้" });
    const t = aliveById(room, target);
    if (!t || t.id === p.id) return cb({ error: "โหวตเป้าหมายไม่ถูกต้อง" });

    room.votes[p.id] = target;
    cb({ ok: true });

    const voters = [...room.players.values()].filter(alive);
    if (voters.every(v => room.votes[v.id])) {
      const tally = {};
      for (const targetId of Object.values(room.votes)) tally[targetId] = (tally[targetId] || 0) + 1;
      const max = Math.max(...Object.values(tally));
      const winners = Object.entries(tally).filter(([,n])=>n===max).map(([id])=>id);
      if (winners.length === 1) {
        const out = room.players.get(winners[0]);
        if (out.role === "Tanner") {
          out.tannerWon = true;
          room.winner = "Tanner";
        } else {
          const before = out.role;
          const ds = kill(room, out.id, "Vote");
          room.deaths.push(...ds);
          if (before === "WolfCub") room.wolfCubBonus = true;
          if (before === "Hunter") room.pendingHunter = out.id;
        }
      }
      room.votes = {};
      if (!room.winner && room.pendingHunter) {
        room.phase = "hunter";
        room.message = "🏹 นายพรานเสียชีวิต — เลือกคนที่จะยิง";
      } else if (checkWinner(room)) {
        room.phase = "gameover";
      } else {
        startNight(room);
        return;
      }
      sendState(room);
    } else {
      sendState(room);
    }
  });

  socket.on("hunterShot", ({ target }, cb) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room || room.phase !== "hunter" || room.pendingHunter !== socket.id) return cb({ error: "ไม่มีสิทธิ์" });
    const t = aliveById(room, target);
    if (!t || t.id === socket.id) return cb({ error: "เป้าหมายไม่ถูกต้อง" });
    const ds = kill(room, t.id, "Hunter");
    room.deaths.push(...ds);
    room.pendingHunter = null;
    if (checkWinner(room)) room.phase = "gameover";
    else startNight(room);
    cb({ ok: true });
    sendState(room);
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
