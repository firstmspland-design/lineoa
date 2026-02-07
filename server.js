// server.js
require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

// ✅ ถ้าเรียกจากที่อื่น (คนละโดเมน) ค่อยเปิด CORS
// app.use((req, res, next) => {
//   res.setHeader("Access-Control-Allow-Origin", "*");
//   res.setHeader("Access-Control-Allow-Headers", "Content-Type");
//   res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
//   if (req.method === "OPTIONS") return res.sendStatus(204);
//   next();
// });

const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "doctornoo_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
});
console.log("DB CONFIG:", {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  hasPass: !!process.env.DB_PASS,
  database: process.env.DB_NAME,
});

// ✅ health check
app.get("/api/health", async (req, res) => {
  try {
    const [r] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: r?.[0]?.ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ✅ PDPA consent endpoint
app.post("/api/pdpa/consent", async (req, res) => {
  try {
    const b = req.body || {};

    // validate ขั้นต่ำ
    if (!b.consent_session_id || !b.consent_version || !b.accepted_at) {
      return res.status(400).json({
        ok: false,
        message: "missing required fields: consent_session_id, consent_version, accepted_at",
      });
    }

    // ดึง ip + ua จาก server ฝั่งนี้ (ไว้ audit)
    const ip =
      (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
      req.socket.remoteAddress ||
      null;
    const ua = (req.headers["user-agent"] || "").toString().slice(0, 500);

    const sql = `
      INSERT INTO dn_pdpa_consent
      (wp_user_id, line_user_id, consent_session_id, consent_version,
       required_consent, marketing_consent, accepted_at, expires_at,
       source_channel, page_path, ip_address, user_agent, created_at)
      VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const params = [
      b.wp_user_id ?? null,
      b.line_user_id ?? null,
      b.consent_session_id,
      b.consent_version,
      Number(b.required_consent ?? 1),
      Number(b.marketing_consent ?? 0),
      // MySQL DATETIME รับเป็น "YYYY-MM-DD HH:mm:ss" จะชัวร์กว่า ISO
      toMysqlDatetime(b.accepted_at),
      b.expires_at ? toMysqlDatetime(b.expires_at) : null,
      b.source_channel === "LIFF" ? "LIFF" : "WEB",
      (b.page_path || "/condition.html").toString().slice(0, 255),
      ip ? ip.toString().slice(0, 45) : null,
      ua,
    ];

    const [result] = await pool.execute(sql, params);
    res.json({ ok: true, consent_id: result.insertId });
  } catch (e) {
    // duplicate consent_session_id
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ ok: false, message: "duplicate consent_session_id" });
    }
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// เสิร์ฟไฟล์หน้าเว็บ (ถ้าใช้ public/)
app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// --- helper: ISO -> MySQL DATETIME
function toMysqlDatetime(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" + pad(d.getMonth() + 1) +
    "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) +
    ":" + pad(d.getMinutes()) +
    ":" + pad(d.getSeconds())
  );
}
 