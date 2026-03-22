const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PREVIEW_DIR = path.join(__dirname, 'uploads', 'previews');

// Создаём папки
[UPLOAD_DIR, PREVIEW_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/files', express.static(UPLOAD_DIR));
app.use('/previews', express.static(PREVIEW_DIR));

// Сессии
app.use(session({
  secret: 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// В самом начале, после импортов
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Настройка загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'preview') {
      cb(null, PREVIEW_DIR);
    } else {
      cb(null, UPLOAD_DIR);
    }
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

// SQLite
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('Ошибка БД:', err);
  else {
    console.log('Подключено к SQLite');
    initDB();
  }
});

function initDB() {
  // Таблица пользователей
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица проектов (обновлённая)
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT CHECK(type IN ('file', 'link')),
      filename TEXT,
      original_name TEXT,
      file_path TEXT,
      link_url TEXT,
      preview_path TEXT,
      file_size INTEGER,
      downloads INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, () => {
    // Создаём админа Fristli если нет
    createDefaultAdmin();
  });
}

async function createDefaultAdmin() {
  const adminExists = await new Promise((resolve) => {
    db.get('SELECT * FROM users WHERE username = ?', ['Fristli'], (err, row) => {
      resolve(!!row);
    });
  });

  if (!adminExists) {
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(password, 10);
    db.run(
      'INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, ?, 1)',
      [uuidv4(), 'Fristli', hash]
    );
    console.log('✅ Админ Fristli создан');
  }
}

// Middleware проверки авторизации
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).json({ error: 'Требуются права администратора' });
  }
  next();
}

// ===== API РОУТЫ =====

// Регистрация (только для обычных пользователей)
app.post('/api/register', async (req, res) => {
    console.log('Попытка регистрации:', req.body);
    
    const { username, password } = req.body;
    
    if (!username || !password) {
        console.log('Ошибка: не все поля заполнены');
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    if (username === 'Fristli') {
        console.log('Ошибка: попытка регистрации зарезервированного имени');
        return res.status(400).json({ error: 'Этот никнейм зарезервирован' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const id = uuidv4();
        
        console.log('Создание пользователя:', { id, username });
        
        db.run(
            'INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, ?, ?)',
            [id, username, hash, 0],
            function(err) {
                if (err) {
                    console.error('Ошибка SQL:', err);
                    if (err.message && (err.message.includes('UNIQUE') || err.message.includes('unique'))) {
                        return res.status(400).json({ error: 'Никнейм уже занят' });
                    }
                    return res.status(500).json({ error: 'Ошибка базы данных' });
                }
                console.log('Пользователь создан успешно');
                res.json({ success: true, message: 'Регистрация успешна' });
            }
        );
    } catch (error) {
        console.error('Ошибка сервера:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.is_admin === 1;

    res.json({
      success: true,
      user: {
        username: user.username,
        isAdmin: user.is_admin === 1
      }
    });
  });
});

// Проверка сессии
app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    username: req.session.username,
    isAdmin: req.session.isAdmin
  });
});

// Выход
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Получить проекты (доступно всем)
app.get('/api/projects', (req, res) => {
  db.all('SELECT * FROM projects ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Загрузить файл (только админ)
app.post('/api/upload', requireAdmin, upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'preview', maxCount: 1 }
]), (req, res) => {
  const { name, description } = req.body;
  const file = req.files['file']?.[0];
  const preview = req.files['preview']?.[0];

  if (!file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }

  const id = uuidv4();
  const previewPath = preview ? `/previews/${preview.filename}` : null;

  db.run(
    `INSERT INTO projects (id, name, description, type, filename, original_name, file_path, preview_path, file_size)
     VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?)`,
    [id, name || file.originalname, description, file.filename, file.originalname, file.path, previewPath, file.size],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      const newProject = {
        id, name: name || file.originalname, description, 
        type: 'file', original_name: file.originalname,
        preview_path: previewPath,
        file_size: file.size, downloads: 0,
        created_at: new Date().toISOString()
      };
      
      io.emit('new_project', newProject);
      res.json({ success: true, project: newProject });
    }
  );
});

// Добавить ссылку (только админ)
app.post('/api/link', requireAdmin, upload.single('preview'), (req, res) => {
  const { name, description, url } = req.body;
  
  if (!name || !url) {
    return res.status(400).json({ error: 'Название и URL обязательны' });
  }

  const id = uuidv4();
  const previewPath = req.file ? `/previews/${req.file.filename}` : null;

  db.run(
    `INSERT INTO projects (id, name, description, type, link_url, preview_path)
     VALUES (?, ?, ?, 'link', ?, ?)`,
    [id, name, description, url, previewPath],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      const newProject = {
        id, name, description, type: 'link', 
        link_url: url, preview_path: previewPath,
        downloads: 0,
        created_at: new Date().toISOString()
      };
      
      io.emit('new_project', newProject);
      res.json({ success: true, project: newProject });
    }
  );
});

// Редактировать проект (только админ)
app.put('/api/projects/:id', requireAdmin, upload.single('preview'), (req, res) => {
  const { id } = req.params;
  const { name, description, url } = req.body;

  // Сначала получаем текущие данные
  db.get('SELECT * FROM projects WHERE id = ?', [id], (err, project) => {
    if (err || !project) {
      return res.status(404).json({ error: 'Проект не найден' });
    }

    let updateQuery, params;
    const previewPath = req.file ? `/previews/${req.file.filename}` : project.preview_path;

    if (project.type === 'file') {
      updateQuery = `UPDATE projects SET name = ?, description = ?, preview_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      params = [name, description, previewPath, id];
    } else {
      updateQuery = `UPDATE projects SET name = ?, description = ?, link_url = ?, preview_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      params = [name, description, url, previewPath, id];
    }

    db.run(updateQuery, params, function(err) {
      if (err) return res.status(500).json({ error: err.message });

      // Удаляем старое превью если загружено новое
      if (req.file && project.preview_path) {
        const oldPreview = path.join(__dirname, project.preview_path);
        if (fs.existsSync(oldPreview)) fs.unlinkSync(oldPreview);
      }

      io.emit('update_project', { id, name, description, url, preview_path: previewPath });
      res.json({ success: true });
    });
  });
});

// Удалить проект (только админ)
app.delete('/api/projects/:id', requireAdmin, (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM projects WHERE id = ?', [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Проект не найден' });

    // Удаляем файлы
    if (row.type === 'file' && fs.existsSync(row.file_path)) {
      fs.unlinkSync(row.file_path);
    }
    if (row.preview_path) {
      const previewPath = path.join(__dirname, row.preview_path);
      if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath);
    }

    db.run('DELETE FROM projects WHERE id = ?', [id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      
      io.emit('delete_project', { id });
      res.json({ success: true });
    });
  });
});

// Скачать файл (доступно всем)
app.get('/api/download/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM projects WHERE id = ?', [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Не найдено' });

    if (row.type === 'link') {
      db.run('UPDATE projects SET downloads = downloads + 1 WHERE id = ?', [id]);
      return res.redirect(row.link_url);
    }

    db.run('UPDATE projects SET downloads = downloads + 1 WHERE id = ?', [id]);

    res.download(row.file_path, row.original_name, (err) => {
      if (err) res.status(500).json({ error: 'Ошибка скачивания' });
    });
  });
});

// WebSocket
io.on('connection', (socket) => {
  console.log('Клиент подключился');
  socket.on('disconnect', () => console.log('Клиент отключился'));
});

// ===== НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ =====

// Получить информацию о пользователе
app.get('/api/user/info', requireAuth, (req, res) => {
    db.get(
        'SELECT id, username, is_admin, created_at FROM users WHERE id = ?',
        [req.session.userId],
        (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            res.json({ success: true, user });
        }
    );
});

// Смена никнейма
app.post('/api/user/change-username', requireAuth, async (req, res) => {
    const { newUsername, password } = req.body;
    
    if (!newUsername || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    if (newUsername.length < 3 || newUsername.length > 20) {
        return res.status(400).json({ error: 'Ник должен быть от 3 до 20 символов' });
    }
    
    // Проверяем пароль
    db.get('SELECT * FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Неверный пароль' });
        }
        
        // Проверяем, не занят ли ник
        if (newUsername === 'Fristli' && user.username !== 'Fristli') {
            return res.status(400).json({ error: 'Этот никнейм зарезервирован' });
        }
        
        db.get('SELECT * FROM users WHERE username = ? AND id != ?', [newUsername, user.id], (err, existing) => {
            if (existing) {
                return res.status(400).json({ error: 'Этот никнейм уже занят' });
            }
            
            db.run(
                'UPDATE users SET username = ? WHERE id = ?',
                [newUsername, user.id],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Ошибка обновления' });
                    }
                    
                    req.session.username = newUsername;
                    res.json({ success: true, username: newUsername });
                }
            );
        });
    });
});

// Смена пароля
app.post('/api/user/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Новый пароль должен быть минимум 6 символов' });
    }
    
    db.get('SELECT * FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Неверный текущий пароль' });
        }
        
        const newHash = await bcrypt.hash(newPassword, 10);
        
        db.run(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [newHash, user.id],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Ошибка обновления пароля' });
                }
                res.json({ success: true });
            }
        );
    });
});

server.listen(PORT, () => {
  console.log(`🚀 Сервер: http://localhost:${PORT}`);
  console.log(`🔐 Админ-панель: http://localhost:${PORT}/admin.html`);
  console.log(`👤 Логин: Fristli / Пароль: admin123`);
});