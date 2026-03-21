import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import TelegramBot from 'node-telegram-bot-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const LINK4M_API_TOKEN = process.env.LINK4M_API_TOKEN || '';
const FREE_KEY_TTL_HOURS = Number(process.env.FREE_KEY_TTL_HOURS || 5);
const LINK_SESSION_TTL_MINUTES = Number(process.env.LINK_SESSION_TTL_MINUTES || 30);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin-token';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-password';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TGBOT_LOGIN_PASSWORD = process.env.TGBOT_LOGIN_PASSWORD || 'change-me-bot-password';
const TG_ADMIN_IDS = (process.env.TG_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const DB_PATH = path.join(__dirname, 'data', 'db.json');

function initDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({
      settings: {
        appName: 'VIP PRO LICENSE PORTAL V4',
        badge: 'FREE TRIAL 5 GIỜ',
        notifications: [
          { id: 'n1', type: 'info', title: 'Portal hoạt động', message: 'Mỗi thiết bị có thể nhận 1 key free 5 giờ sau khi hoàn tất link trung gian.', createdAt: Date.now() - 3600000 },
          { id: 'n2', type: 'success', title: 'Admin riêng', message: 'Admin quản lý key, thiết bị và thông báo tại trang riêng hoặc Telegram bot.', createdAt: Date.now() - 1800000 }
        ]
      },
      freeSessions: {},
      keys: {},
      botSessions: {},
      adminAudit: []
    }, null, 2));
  }
}
function db() { initDb(); return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
function save(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }
function rid(n = 10) { return crypto.randomBytes(n).toString('hex'); }
function makeKey(prefix = 'FREE') { const p = () => crypto.randomBytes(2).toString('hex').toUpperCase(); return `${prefix}-${p()}-${p()}-${p()}-${p()}`; }
function activeKey(k) { return k && k.active !== false && (!k.expiresAt || k.expiresAt > Date.now()); }
function adminOk(req) { const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim(); return req.headers['x-admin-token'] === ADMIN_TOKEN || bearer === ADMIN_TOKEN; }
function requireAdmin(req, res, next) { if (!adminOk(req)) return res.status(401).json({ ok: false, message: 'Admin token không hợp lệ.' }); next(); }
function audit(action, meta = {}) { const data = db(); data.adminAudit.unshift({ id: rid(4), action, meta, createdAt: Date.now() }); data.adminAudit = data.adminAudit.slice(0, 200); save(data); }
function loginKey(data, key, deviceId, userAgent) {
  const row = data.keys[key];
  if (!row) throw new Error('Key không tồn tại.');
  if (row.active === false) throw new Error('Key đã bị vô hiệu hóa.');
  if (row.expiresAt && row.expiresAt <= Date.now()) throw new Error('Key đã hết hạn.');
  row.devices ||= {};
  const bound = Object.keys(row.devices);
  if (row.type === 'free' && row.ownerDeviceId && row.ownerDeviceId !== deviceId) throw new Error('Key free chỉ dùng trên thiết bị đã nhận key.');
  if (!row.devices[deviceId]) {
    if (bound.length >= Number(row.maxDevices || 1)) throw new Error(`Key đã đạt giới hạn ${row.maxDevices || 1} thiết bị.`);
    row.devices[deviceId] = { firstLogin: Date.now(), lastLogin: Date.now(), userAgent };
  } else {
    row.devices[deviceId].lastLogin = Date.now();
    row.devices[deviceId].userAgent = userAgent;
  }
  return row;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));
app.get('/api/public/config', (_req, res) => res.json({ ok: true, settings: db().settings, freeKeyHours: FREE_KEY_TTL_HOURS }));
app.get('/api/public/notifications', (_req, res) => res.json({ ok: true, notifications: db().settings.notifications || [] }));

app.post('/api/free-link/create', async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (!deviceId) return res.status(400).json({ ok: false, message: 'Thiếu deviceId.' });
    const data = db();
    const existing = Object.values(data.freeSessions).find(v => v.deviceId === deviceId && v.expiresAt > Date.now());
    if (existing) return res.json({ ok: true, rid: existing.rid, shortUrl: existing.shortUrl, expiresAt: existing.expiresAt });
    const id = rid();
    const state = rid(12);
    const verifyUrl = `${APP_BASE_URL}/verify?rid=${encodeURIComponent(id)}&state=${encodeURIComponent(state)}`;
    let shortUrl = verifyUrl;
    if (LINK4M_API_TOKEN) {
      const apiUrl = new URL('https://link4m.co/api-shorten/v2');
      apiUrl.searchParams.set('api', LINK4M_API_TOKEN);
      apiUrl.searchParams.set('url', verifyUrl);
      const rf = await fetch(apiUrl.toString());
      const out = await rf.json();
      if (out.status !== 'success' || !out.shortenedUrl) throw new Error(out.message || 'Tạo short-link thất bại.');
      shortUrl = out.shortenedUrl;
    }
    data.freeSessions[id] = { rid: id, state, deviceId, verified: false, shortUrl, verifyUrl, createdAt: Date.now(), expiresAt: Date.now() + LINK_SESSION_TTL_MINUTES * 60 * 1000 };
    save(data);
    res.json({ ok: true, rid: id, shortUrl, expiresAt: data.freeSessions[id].expiresAt, fallbackDirect: !LINK4M_API_TOKEN });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || 'Không tạo được link.' });
  }
});

app.get('/verify', (req, res) => {
  const { rid: id, state } = req.query || {};
  const data = db();
  const row = data.freeSessions[id];
  if (!row) return res.redirect('/free-key.html?error=' + encodeURIComponent('RID không hợp lệ'));
  if (row.expiresAt <= Date.now()) return res.redirect('/free-key.html?error=' + encodeURIComponent('Phiên đã hết hạn'));
  if (row.state !== state) return res.redirect('/free-key.html?error=' + encodeURIComponent('Xác thực không hợp lệ'));
  row.verified = true; row.verifiedAt = Date.now(); save(data);
  res.redirect('/free-key.html?verified=1&rid=' + encodeURIComponent(id));
});

app.post('/api/free-key/claim', (req, res) => {
  try {
    const { rid: id, deviceId, userAgent } = req.body || {};
    const data = db();
    const row = data.freeSessions[id];
    if (!row) return res.status(404).json({ ok: false, message: 'Phiên không tồn tại.' });
    if (row.expiresAt <= Date.now()) return res.status(400).json({ ok: false, message: 'Phiên đã hết hạn.' });
    if (!row.verified) return res.status(403).json({ ok: false, message: 'Bạn chưa hoàn tất link.' });
    if (row.deviceId !== deviceId) return res.status(403).json({ ok: false, message: 'Sai thiết bị.' });
    let keyRow = Object.values(data.keys).find(k => k.type === 'free' && k.ownerDeviceId === deviceId && activeKey(k));
    if (!keyRow) {
      const key = makeKey('FREE');
      keyRow = { key, type: 'free', active: true, note: `Free trial ${FREE_KEY_TTL_HOURS} giờ`, createdAt: Date.now(), expiresAt: Date.now() + FREE_KEY_TTL_HOURS * 60 * 60 * 1000, maxDevices: 1, ownerDeviceId: deviceId, devices: {} };
      data.keys[key] = keyRow;
    }
    keyRow.devices[deviceId] = { firstLogin: keyRow.devices[deviceId]?.firstLogin || Date.now(), lastLogin: Date.now(), userAgent: userAgent || 'free-key-portal' };
    save(data);
    res.json({ ok: true, key: keyRow.key, expiresAt: keyRow.expiresAt, note: keyRow.note, maxDevices: 1 });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || 'Không thể nhận key.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { key, deviceId, userAgent } = req.body || {};
    if (!key || !deviceId) return res.status(400).json({ ok: false, message: 'Thiếu key hoặc deviceId.' });
    const data = db();
    const row = loginKey(data, String(key).trim().toUpperCase(), deviceId, userAgent || '');
    save(data);
    res.json({ ok: true, keyData: { key: row.key, type: row.type, note: row.note || '', active: row.active !== false, maxDevices: row.maxDevices || 1, expiresAt: row.expiresAt || null, devices: row.devices || {} } });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message || 'Đăng nhập thất bại.' });
  }
});

app.post('/api/auth/status', (req, res) => {
  const { key, deviceId } = req.body || {};
  const data = db();
  const row = data.keys[String(key || '').trim().toUpperCase()];
  if (!row) return res.status(404).json({ ok: false, message: 'Key không tồn tại.' });
  if (row.active === false) return res.status(403).json({ ok: false, message: 'Key đã bị vô hiệu hóa.' });
  if (row.expiresAt && row.expiresAt <= Date.now()) return res.status(403).json({ ok: false, message: 'Key đã hết hạn.' });
  if (row.type === 'free' && row.ownerDeviceId && row.ownerDeviceId !== deviceId) return res.status(403).json({ ok: false, message: 'Key free không thuộc thiết bị này.' });
  res.json({ ok: true, keyData: { key: row.key, type: row.type, note: row.note || '', active: row.active !== false, maxDevices: row.maxDevices || 1, expiresAt: row.expiresAt || null, devices: row.devices || {} } });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password, token } = req.body || {};
  const ok = token === ADMIN_TOKEN || (username === ADMIN_USERNAME && password === ADMIN_PASSWORD);
  if (!ok) return res.status(401).json({ ok: false, message: 'Sai thông tin admin.' });
  audit('admin.login', { username: username || 'token' });
  res.json({ ok: true, token: ADMIN_TOKEN });
});
app.get('/api/admin/stats', requireAdmin, (_req, res) => {
  const data = db();
  const keys = Object.values(data.keys);
  const devices = keys.flatMap(k => Object.keys(k.devices || {}));
  res.json({ ok: true, stats: { totalKeys: keys.length, activeKeys: keys.filter(activeKey).length, expiredKeys: keys.filter(k => k.expiresAt && k.expiresAt <= Date.now()).length, devices: devices.length, pendingFreeSessions: Object.values(data.freeSessions).filter(v => v.expiresAt > Date.now()).length } });
});
app.get('/api/admin/keys', requireAdmin, (_req, res) => { const data = db(); res.json({ ok: true, keys: Object.values(data.keys).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)) }); });
app.get('/api/admin/devices', requireAdmin, (_req, res) => {
  const data = db();
  const rows = [];
  for (const k of Object.values(data.keys)) for (const [deviceId, meta] of Object.entries(k.devices || {})) rows.push({ deviceId, key: k.key, keyType: k.type, firstLogin: meta.firstLogin || null, lastLogin: meta.lastLogin || null, userAgent: meta.userAgent || '' });
  rows.sort((a,b)=>(b.lastLogin||0)-(a.lastLogin||0));
  res.json({ ok: true, devices: rows });
});
app.get('/api/admin/audit', requireAdmin, (_req, res) => res.json({ ok: true, audit: db().adminAudit || [] }));
app.post('/api/admin/keys', requireAdmin, (req, res) => {
  const { prefix = 'VIP', hours = 24, maxDevices = 1, note = '' } = req.body || {};
  const data = db();
  const key = makeKey(String(prefix).toUpperCase().slice(0, 8));
  data.keys[key] = { key, type: 'admin', active: true, note, createdAt: Date.now(), expiresAt: Number(hours) > 0 ? Date.now() + Number(hours) * 60 * 60 * 1000 : null, maxDevices: Number(maxDevices) || 1, devices: {} };
  save(data); audit('admin.key.create', { key, hours, maxDevices, note });
  res.json({ ok: true, key: data.keys[key] });
});
app.post('/api/admin/keys/:key/toggle', requireAdmin, (req, res) => {
  const data = db(); const row = data.keys[String(req.params.key).trim().toUpperCase()];
  if (!row) return res.status(404).json({ ok: false, message: 'Không tìm thấy key.' });
  row.active = !row.active; save(data); audit('admin.key.toggle', { key: row.key, active: row.active }); res.json({ ok: true, key: row });
});
app.post('/api/admin/keys/:key/extend', requireAdmin, (req, res) => {
  const data = db(); const row = data.keys[String(req.params.key).trim().toUpperCase()];
  if (!row) return res.status(404).json({ ok: false, message: 'Không tìm thấy key.' });
  const hours = Number(req.body?.hours || 24); const base = row.expiresAt && row.expiresAt > Date.now() ? row.expiresAt : Date.now(); row.expiresAt = base + hours * 60 * 60 * 1000; save(data); audit('admin.key.extend', { key: row.key, hours }); res.json({ ok: true, key: row });
});
app.post('/api/admin/notifications', requireAdmin, (req, res) => {
  const { type = 'info', title = 'Thông báo', message = '' } = req.body || {};
  const data = db(); data.settings.notifications.unshift({ id: rid(4), type, title, message, createdAt: Date.now() }); data.settings.notifications = data.settings.notifications.slice(0, 100); save(data); audit('admin.notification.create', { title }); res.json({ ok: true });
});

function startBot(){
  if (!TELEGRAM_BOT_TOKEN) return;
  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  const help = [
    '📌 VIP License Admin Bot',
    '/login <password> - đăng nhập bot',
    '/taokey <hours> <maxDevices> <note> - tạo key',
    '/quanlithietbi - xem thiết bị',
    '/xemkey <KEY> - xem key',
    '/khoakey <KEY> - khóa key',
    '/mokey <KEY> - mở key',
    '/thongbao <nội dung> - gửi thông báo'
  ].join('\n');
  const authed = chatId => { const data = db(); return TG_ADMIN_IDS.includes(String(chatId)) || Boolean(data.botSessions?.[String(chatId)]?.loggedIn); };
  const guard = msg => { if (authed(msg.chat.id)) return true; bot.sendMessage(msg.chat.id, '🔒 Bạn cần /login trước khi dùng lệnh này.'); return false; };
  bot.onText(/\/start|\/help/, msg => bot.sendMessage(msg.chat.id, help));
  bot.onText(/\/login(?:\s+(.+))?/, (msg, m) => {
    const pass = (m?.[1] || '').trim();
    if (TG_ADMIN_IDS.includes(String(msg.chat.id)) || pass === TGBOT_LOGIN_PASSWORD) {
      const data = db(); data.botSessions ||= {}; data.botSessions[String(msg.chat.id)] = { loggedIn: true, at: Date.now() }; save(data); return bot.sendMessage(msg.chat.id, '✅ Đăng nhập bot thành công.');
    }
    bot.sendMessage(msg.chat.id, '❌ Sai mật khẩu bot.');
  });
  bot.onText(/\/taokey(?:\s+(\d+))?(?:\s+(\d+))?(?:\s+(.+))?/, (msg, m) => {
    if (!guard(msg)) return; const hours = Number(m?.[1] || 24), maxDevices = Number(m?.[2] || 1), note = (m?.[3] || 'Tạo từ Telegram bot').trim();
    const data = db(); const key = makeKey('VIP'); data.keys[key] = { key, type: 'admin', active: true, note, createdAt: Date.now(), expiresAt: Date.now() + hours * 60 * 60 * 1000, maxDevices, devices: {} }; save(data); audit('bot.key.create', { key, hours, maxDevices });
    bot.sendMessage(msg.chat.id, `✅ Tạo key thành công\n\nKey: ${key}\nGiờ dùng: ${hours}h\nThiết bị tối đa: ${maxDevices}\nGhi chú: ${note}`);
  });
  bot.onText(/\/xemkey\s+(.+)/, (msg, m) => { if (!guard(msg)) return; const key = String(m?.[1] || '').trim().toUpperCase(); const row = db().keys[key]; if (!row) return bot.sendMessage(msg.chat.id, '❌ Không tìm thấy key.'); bot.sendMessage(msg.chat.id, [`🔑 ${row.key}`, `Loại: ${row.type}`, `Trạng thái: ${row.active !== false ? 'Hoạt động' : 'Khóa'}`, `Hết hạn: ${row.expiresAt ? new Date(row.expiresAt).toLocaleString('vi-VN') : 'Vĩnh viễn'}`, `Thiết bị: ${Object.keys(row.devices || {}).length}/${row.maxDevices || 1}`, `Ghi chú: ${row.note || '-'}`].join('\n')); });
  bot.onText(/\/khoakey\s+(.+)/, (msg, m) => { if (!guard(msg)) return; const key = String(m?.[1] || '').trim().toUpperCase(); const data = db(); if (!data.keys[key]) return bot.sendMessage(msg.chat.id, '❌ Không tìm thấy key.'); data.keys[key].active = false; save(data); audit('bot.key.lock', { key }); bot.sendMessage(msg.chat.id, `⛔ Đã khóa key ${key}`); });
  bot.onText(/\/mokey\s+(.+)/, (msg, m) => { if (!guard(msg)) return; const key = String(m?.[1] || '').trim().toUpperCase(); const data = db(); if (!data.keys[key]) return bot.sendMessage(msg.chat.id, '❌ Không tìm thấy key.'); data.keys[key].active = true; save(data); audit('bot.key.unlock', { key }); bot.sendMessage(msg.chat.id, `✅ Đã mở lại key ${key}`); });
  bot.onText(/\/quanlithietbi(?:\s+(.+))?/, (msg, m) => {
    if (!guard(msg)) return; const keyFilter = String(m?.[1] || '').trim().toUpperCase(); const data = db(); const out = [];
    for (const row of Object.values(data.keys)) { if (keyFilter && row.key !== keyFilter) continue; const entries = Object.entries(row.devices || {}); if (!entries.length) continue; out.push(`🔑 ${row.key}`); entries.forEach(([deviceId, meta], i) => out.push(`${i+1}. ${deviceId.slice(0, 8)}… | ${meta.lastLogin ? new Date(meta.lastLogin).toLocaleString('vi-VN') : '-'}`)); out.push(''); }
    bot.sendMessage(msg.chat.id, out.length ? out.join('\n') : 'Không có thiết bị nào.');
  });
  bot.onText(/\/thongbao\s+(.+)/, (msg, m) => { if (!guard(msg)) return; const message = (m?.[1] || '').trim(); const data = db(); data.settings.notifications.unshift({ id: rid(4), type: 'info', title: 'Thông báo từ Telegram bot', message, createdAt: Date.now() }); data.settings.notifications = data.settings.notifications.slice(0, 100); save(data); audit('bot.notification.create', { message }); bot.sendMessage(msg.chat.id, '✅ Đã gửi thông báo tới app.'); });
  console.log('Telegram bot started');
}
startBot();
app.listen(PORT, () => console.log(`Server running at ${APP_BASE_URL}`));
