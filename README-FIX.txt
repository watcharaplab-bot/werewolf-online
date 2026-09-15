# Werewolf Online - fixed build

สำคัญ:
1. Publish/Republish ให้เสร็จก่อน
2. เปิด URL .replit.app ที่ Published
3. HOST ต้อง Refresh หน้าเว็บหลัง Republish แล้ว "สร้างห้องใหม่"
4. ส่ง URL .replit.app เดียวกัน + Room Code ใหม่ให้เพื่อน
5. ระหว่างกำลังเล่น ห้ามกด Republish เพราะ server.js เก็บห้องไว้ใน RAM (rooms = new Map())

เวอร์ชันนี้เพิ่มการตรวจจับห้องเก่าที่ค้างบนหน้าจอหลัง Server restart/republish
เพื่อไม่ให้ HOST เห็น Room Code เก่า ทั้งที่ Server ไม่มีห้องนั้นแล้ว

ถ้าต้องการให้ห้องอยู่รอดแม้ Republish/Server restart จริง ๆ ต้องย้าย room state
จาก RAM ไป Production Database และใช้ persistent player/session IDs.
