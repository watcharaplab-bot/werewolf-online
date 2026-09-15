# Werewolf Online Multiplayer

เกม Werewolf Online สำหรับสูงสุด 15 คน ใช้ Room เดิมเล่นรอบใหม่ได้

## ความสามารถ
- Create / Join Room
- HOST เลือก Role ก่อนเริ่มเกม
- เลือก Role ซ้ำได้
- จำนวน Role ต้องเท่ากับจำนวนผู้เล่น
- Server สุ่ม Role
- ผู้เล่นเห็น Role ของตัวเองเท่านั้น
- Night / Day / Voting
- Seer, Bodyguard, Hunter, Cupid, Tanner, Diseased, Huntress, Drunk
- Werewolf, Wolf Cub, Dire Wolf
- จบเกมแล้ว HOST กด Play Again เพื่อกลับไปเลือก Role โดยไม่สร้างห้องใหม่

## ติดตั้ง

ต้องมี Node.js 18+ จากนั้น:

```bash
npm install
npm start
```

เปิด:
http://localhost:3000

## เล่นหลายเครื่องใน LAN

ให้เครื่องที่รัน Server หา IP เช่น `192.168.1.20`

เครื่องอื่นเปิด:
`http://192.168.1.20:3000`

ถ้าจะให้เล่นผ่าน Internet ต้องนำ Server ไป deploy บน VPS / Render / Railway / Fly.io / Cloud VM และเปิด WebSocket/Socket.IO

## หมายเหตุ
โค้ดชุดนี้เป็น MVP ที่พร้อมทดลองเล่นและต่อยอด production ได้ แต่ระบบเกมยังควรเพิ่ม authentication, reconnect/resume, rate limiting, persistent rooms/database และ validation เชิงลึกก่อนเปิดใช้งานจริงบน Internet
