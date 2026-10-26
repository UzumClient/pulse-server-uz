# Pulse Cosmetics Server (UzumClient)

Shaxsiy Minecraft Pulse Cosmetics sinxronizatsiya serveri.

## Xususiyatlari:
- O'yinchi kosmetikalarini qabul qilish va saqlash (`/api/cosmetics/state`)
- Kosmetika so'rovlari (`/api/cosmetics/query`)
- Tiriklik signallari (Heartbeat) (`/api/pulse-cosmetics/heartbeat`)
- Jonli voqealar oqimi SSE (`/api/events`)
- Graffiti tizimi (`/api/graffiti/state`, `/api/graffiti/query`)
- Vercel va Render.com da 24/7 bepul ishlashga to'liq moslangan
- Brauzerda ochiladigan chiroyli Web Dashboard

## Ishga tushirish (Local):
```bash
node server.js
```
Port: `3000` (yoki `PORT` env o'zgaruvchisi)
