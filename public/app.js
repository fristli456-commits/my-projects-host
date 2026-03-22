const socket = io();
let allProjects = [];
let currentUser = null;

// Проверка авторизации при загрузке
async function checkAuth() {
    try {
        const response = await fetch('/api/me');
        const data = await response.json();
        
        if (data.authenticated) {
            currentUser = data;
            updateAuthUI();
            
            // Если админ - редирект на админку
            if (data.isAdmin) {
                window.location.href = '/admin.html';
            }
        }
    } catch (error) {
        console.error('Ошибка проверки авторизации:', error);
    }
}

function updateAuthUI() {
    const authSection = document.getElementById('authSection');
    if (currentUser) {
        authSection.innerHTML = `
            <a href="/settings.html" class="btn-secondary" style="margin-right: 10px; text-decoration: none;">
                <i class="fas fa-cog"></i> Настройки
            </a>
            <button onclick="logout()" class="btn-secondary">
                <i class="fas fa-sign-out-alt"></i> Выйти
            </button>
        `;
    }
}

// Модальные окна
function showLoginModal() {
    document.getElementById('loginModal').classList.add('show');
}

function closeLoginModal() {
    document.getElementById('loginModal').classList.remove('show');
}

function showRegisterForm() {
    closeLoginModal();
    document.getElementById('registerModal').classList.add('show');
}

function closeRegisterModal() {
    document.getElementById('registerModal').classList.remove('show');
}

// Вход
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const data = {
        username: document.getElementById('loginUsername').value,
        password: document.getElementById('loginPassword').value
    };

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            currentUser = result.user;
            if (result.user.isAdmin) {
                window.location.href = '/admin.html';
            } else {
                closeLoginModal();
                updateAuthUI();
                showNotification('Вход выполнен!', 'success');
            }
        } else {
            showNotification(result.error, 'error');
        }
    } catch (error) {
        showNotification('Ошибка входа', 'error');
    }
});

// Регистрация
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const data = {
        username: document.getElementById('regUsername').value,
        password: document.getElementById('regPassword').value
    };

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeRegisterModal();
            showNotification('Регистрация успешна! Теперь войдите.', 'success');
        } else {
            showNotification(result.error, 'error');
        }
    } catch (error) {
        showNotification('Ошибка регистрации', 'error');
    }
});

// Выход
async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        currentUser = null;
        window.location.reload();
    } catch (error) {
        showNotification('Ошибка выхода', 'error');
    }
}

// Загрузка проектов
async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        allProjects = await response.json();
        displayProjects(allProjects);
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        document.getElementById('projectsList').innerHTML = 
            '<div class="empty">Ошибка загрузки проектов</div>';
    }
}

function displayProjects(projects) {
    const container = document.getElementById('projectsList');
    
    if (projects.length === 0) {
        container.innerHTML = '<div class="empty">Пока нет проектов</div>';
        return;
    }

    container.innerHTML = projects.map(project => {
        const isFile = project.type === 'file';
        const hasMobileVersion = project.mobile_file_size && project.mobile_file_size > 0;
        const downloads = project.downloads || 0;
        
        // Размеры
        let sizeHtml = 'Ссылка';
        if (isFile) {
            if (hasMobileVersion) {
                const pcSize = formatFileSize(project.file_size);
                const mobileSize = formatFileSize(project.mobile_file_size);
                sizeHtml = `<div style="font-size: 0.85em; line-height: 1.3;">
                    <span>💻 ${pcSize}</span>
                    <span style="display: block;">📱 ${mobileSize}</span>
                </div>`;
            } else {
                sizeHtml = formatFileSize(project.file_size);
            }
        }
        
        // Превью
        let previewHtml;
        if (project.preview_path) {
            previewHtml = `<img src="${project.preview_path}" alt="${escapeHtml(project.name)}">`;
        } else {
            const icon = isFile ? getFileIcon(project.original_name) : 'fa-link';
            previewHtml = `<i class="fas ${icon}"></i>`;
        }

        // Кнопки скачивания
        let downloadHtml;
        if (isFile) {
            if (hasMobileVersion) {
                downloadHtml = `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                        <a href="/api/download/${project.id}?version=pc" class="download-btn" style="flex: 1;">
                            <i class="fas fa-download"></i> 💻
                        </a>
                        <a href="/api/download/${project.id}?version=mobile" class="download-btn" style="flex: 1;">
                            <i class="fas fa-download"></i> 📱
                        </a>
                    </div>
                `;
            } else {
                downloadHtml = `<a href="/api/download/${project.id}" class="download-btn">
                    <i class="fas fa-download"></i> Скачать
                </a>`;
            }
        } else {
            downloadHtml = `<a href="/api/download/${project.id}" class="download-btn" target="_blank">
                <i class="fas fa-external-link-alt"></i> Перейти
            </a>`;
        }

        return `
            <div class="project-card">
                <div class="project-preview">
                    ${previewHtml}
                </div>
                <div class="project-content">
                    <h3>${escapeHtml(project.name)}</h3>
                    <p>${escapeHtml(project.description || 'Без описания')}</p>
                    <div class="file-meta">
                        <span>${sizeHtml}</span>
                        <span><i class="fas fa-download"></i> ${downloads}</span>
                    </div>
                    ${downloadHtml}
                </div>
            </div>
        `;
    }).join('');
}


function getFileIcon(filename) {
    if (!filename) return 'fa-file';
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'exe': 'fa-windows',
        'apk': 'fa-android',
        'ipa': 'fa-apple',
        'zip': 'fa-file-archive',
        'rar': 'fa-file-archive',
        'pdf': 'fa-file-pdf',
        'doc': 'fa-file-word',
        'docx': 'fa-file-word',
        'jpg': 'fa-file-image',
        'jpeg': 'fa-file-image',
        'png': 'fa-file-image',
        'mp4': 'fa-file-video',
        'mp3': 'fa-file-audio'
    };
    return icons[ext] || 'fa-file';
}

function formatFileSize(bytes) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Поиск
document.getElementById('searchInput')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allProjects.filter(p => 
        p.name.toLowerCase().includes(query) || 
        (p.description && p.description.toLowerCase().includes(query))
    );
    displayProjects(filtered);
});

// Уведомления
function showNotification(text, type) {
    const div = document.createElement('div');
    div.className = `notification ${type}`;
    div.textContent = text;
    document.body.appendChild(div);
    
    setTimeout(() => div.remove(), 3000);
}

// Real-time
socket.on('new_project', () => loadProjects());
socket.on('delete_project', () => loadProjects());
socket.on('update_project', () => loadProjects());

// Закрытие модалок по клику вне
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('show');
    }
}

// Инициализация
checkAuth();
loadProjects();