const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const session = require('express-session');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Cloudinary storage
const fileStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: file.fieldname === 'preview' ? 'previews' : 'uploads',
    resource_type: 'raw', // ← было 'auto', меняем на 'raw'
    public_id: uuidv4(),
    format: path.extname(file.originalname).slice(1) || undefined,
  }),
});

const upload = multer({
  storage: fileStorage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Инициализация БД
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT CHECK(type IN ('file', 'link')),
      filename TEXT,
      original_name TEXT,
      file_path TEXT,
      file_public_id TEXT,
      link_url TEXT,
      preview_path TEXT,
      preview_public_id TEXT,
      file_size INTEGER,
      downloads INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await createDefaultAdmin();
  console.log('✅ База данных готова');
}

async function createDefaultAdmin() {
  const result = await pool.query('SELECT * FROM users WHERE username = $1', ['Fristli']);
  if (result.rows.length === 0) {
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (id, username, password_hash, is_admin) VALUES ($1, $2, $3, 1)',
      [uuidv4(), 'Fristli', hash]
    );
    console.log('✅ Админ Fristli создан');
  }
}

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin) return res.status(403).json({ error: 'Требуются права администратора' });
  next();
}

// ===== API РОУТЫ =====

// Регистрация
app.post('/api/register', async (req, res) => {
  console.log('Попытка регистрации:', req.body);
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }
  if (username === 'Fristli') {
    return res.status(400).json({ error: 'Этот никнейм зарезервирован' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await pool.query(
      'INSERT INTO users (id, username, password_hash, is_admin) VALUES ($1, $2, $3, 0)',
      [id, username, hash]
    );
    console.log('Пользователь создан успешно');
    res.json({ success: true, message: 'Регистрация успешна' });
  } catch (err) {
    console.error('Ошибка SQL:', err);
    if (err.code === '23505') return res.status(400).json({ error: 'Никнейм уже занят' });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Неверный логин или пароль' });

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.is_admin === 1;

    res.json({ success: true, user: { username: user.username, isAdmin: user.is_admin === 1 } });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Проверка сессии
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: req.session.username, isAdmin: req.session.isAdmin });
});

// Выход
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Получить проекты
app.get('/api/projects', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка загрузки:', JSON.stringify(err));
    res.status(500).json({ error: err.message });
  }
});

// Загрузить файл (только админ)
app.post('/api/upload', requireAdmin, upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'preview', maxCount: 1 }
], (multerErr, req, res, next) => {
  if (multerErr) {
    console.error('Ошибка multer:', multerErr);
    return res.status(500).json({ error: multerErr.message });
  }
  next();
}), async (req, res) => {
  const { name, description } = req.body;
  const file = req.files['file']?.[0];
  const preview = req.files['preview']?.[0];

  if (!file) return res.status(400).json({ error: 'Файл не загружен' });

  const id = uuidv4();
  const previewPath = preview ? preview.path : null;
  const previewPublicId = preview ? preview.filename : null;

  try {
    await pool.query(
      `INSERT INTO projects (id, name, description, type, filename, original_name, file_path, file_public_id, preview_path, preview_public_id, file_size)
       VALUES ($1, $2, $3, 'file', $4, $5, $6, $7, $8, $9, $10)`,
      [id, name || file.originalname, description, file.filename, file.originalname, file.path, file.filename, previewPath, previewPublicId, file.size]
    );

    const newProject = {
      id, name: name || file.originalname, description,
      type: 'file', original_name: file.originalname,
      file_path: file.path, preview_path: previewPath,
      file_size: file.size, downloads: 0,
      created_at: new Date().toISOString()
    };

    io.emit('new_project', newProject);
    res.json({ success: true, project: newProject });
  } catch (err) {
    console.error('Ошибка upload:', JSON.stringify(err, null, 2));
    res.status(500).json({ error: err.message });
  }
});

// Добавить ссылку (только админ)
app.post('/api/link', requireAdmin, upload.single('preview'), async (req, res) => {
  const { name, description, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Название и URL обязательны' });

  const id = uuidv4();
  const previewPath = req.file ? req.file.path : null;
  const previewPublicId = req.file ? req.file.filename : null;

  try {
    await pool.query(
      `INSERT INTO projects (id, name, description, type, link_url, preview_path, preview_public_id)
       VALUES ($1, $2, $3, 'link', $4, $5, $6)`,
      [id, name, description, url, previewPath, previewPublicId]
    );

    const newProject = {
      id, name, description, type: 'link',
      link_url: url, preview_path: previewPath,
      downloads: 0, created_at: new Date().toISOString()
    };
    io.emit('new_project', newProject);
    res.json({ success: true, project: newProject });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Редактировать проект (только админ)
app.put('/api/projects/:id', requireAdmin, upload.single('preview'), async (req, res) => {
  const { id } = req.params;
  const { name, description, url } = req.body;

  try {
    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    const project = result.rows[0];
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    let previewPath = project.preview_path;
    let previewPublicId = project.preview_public_id;

    if (req.file) {
      if (project.preview_public_id) {
        await cloudinary.uploader.destroy(project.preview_public_id);
      }
      previewPath = req.file.path;
      previewPublicId = req.file.filename;
    }

    if (project.type === 'file') {
      await pool.query(
        `UPDATE projects SET name = $1, description = $2, preview_path = $3, preview_public_id = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5`,
        [name, description, previewPath, previewPublicId, id]
      );
    } else {
      await pool.query(
        `UPDATE projects SET name = $1, description = $2, link_url = $3, preview_path = $4, preview_public_id = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6`,
        [name, description, url, previewPath, previewPublicId, id]
      );
    }

    io.emit('update_project', { id, name, description, url, preview_path: previewPath });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Удалить проект (только админ)
app.delete('/api/projects/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Проект не найден' });

    if (row.file_public_id) {
      await cloudinary.uploader.destroy(row.file_public_id, { resource_type: 'auto' });
    }
    if (row.preview_public_id) {
      await cloudinary.uploader.destroy(row.preview_public_id);
    }

    await pool.query('DELETE FROM projects WHERE id = $1', [id]);
    io.emit('delete_project', { id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Скачать файл
app.get('/api/download/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Не найдено' });

    await pool.query('UPDATE projects SET downloads = downloads + 1 WHERE id = $1', [id]);

    if (row.type === 'link') return res.redirect(row.link_url);
    res.redirect(row.file_path);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WebSocket
io.on('connection', (socket) => {
  console.log('Клиент подключился');
  socket.on('disconnect', () => console.log('Клиент отключился'));
});

// ===== НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ =====

// Получить информацию о пользователе
app.get('/api/user/info', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, is_admin, created_at FROM users WHERE id = $1',
      [req.session.userId]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Смена никнейма
app.post('/api/user/change-username', requireAuth, async (req, res) => {
  const { newUsername, password } = req.body;

  if (!newUsername || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (newUsername.length < 3 || newUsername.length > 20) return res.status(400).json({ error: 'Ник должен быть от 3 до 20 символов' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Неверный пароль' });

    if (newUsername === 'Fristli' && user.username !== 'Fristli') {
      return res.status(400).json({ error: 'Этот никнейм зарезервирован' });
    }

    const existing = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND id != $2',
      [newUsername, user.id]
    );
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Этот никнейм уже занят' });

    await pool.query('UPDATE users SET username = $1 WHERE id = $2', [newUsername, user.id]);
    req.session.username = newUsername;
    res.json({ success: true, username: newUsername });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

// Смена пароля
app.post('/api/user/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Заполните все поля' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Новый пароль должен быть минимум 6 символов' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Неверный текущий пароль' });

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка обновления пароля' });
  }
});

// Запуск
initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Сервер: http://localhost:${PORT}`);
    console.log(`🔐 Админ-панель: http://localhost:${PORT}/admin.html`);
    console.log(`👤 Логин: Fristli`);
  });
}).catch(err => {
  console.error('Ошибка запуска:', err);
  process.exit(1);
});