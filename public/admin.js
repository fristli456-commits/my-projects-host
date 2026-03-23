const socket = io();

function goToSite() {
    window.location.href = '/';
}

async function checkAdminAuth() {
    try {
        const response = await fetch('/api/me');
        const data = await response.json();
        
        if (!data.authenticated || !data.isAdmin) {
            window.location.href = '/';
            return;
        }
        
        document.getElementById('adminAuthSection').innerHTML = `
            <span style="color: #ff6666; margin-right: 15px;">👑 ${data.username}</span>
            <a href="/settings.html" class="btn-secondary" style="margin-right: 10px;">
                <i class="fas fa-cog"></i> Настройки
            </a>
            <button onclick="logout()" class="btn-secondary">
                <i class="fas fa-sign-out-alt"></i> Выйти
            </button>
        `;
        
        loadAdminProjects();
    } catch (error) {
        window.location.href = '/';
    }
}

function logout() {
    fetch('/api/logout', { method: 'POST' }).then(() => {
        window.location.href = '/';
    });
}

// Превью
document.getElementById('previewInput')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const thumb = document.getElementById('previewThumb');
    
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            thumb.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
            thumb.classList.add('show');
        };
        reader.readAsDataURL(file);
    }
});

// Инфо о файле
document.getElementById('fileInput')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const info = document.getElementById('fileInfo');
    
    if (file) {
        const size = formatFileSize(file.size);
        info.innerHTML = `<strong>📁 ${file.name}</strong><br>📊 ${size}`;
        info.classList.add('show');
    }
});

// Загрузка файла с прогрессом
document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submitBtn');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const file = document.getElementById('fileInput').files[0];
    const mobileFile = document.getElementById('mobileFileInput')?.files[0];
    const previewFile = document.getElementById('previewInput').files[0];
    const name = document.getElementById('fileName').value;
    const description = document.getElementById('fileDescription').value;

    if (!file && !mobileFile) {
        showNotification('❌ Выберите хотя бы один файл', 'error');
        return;
    }

    submitBtn.disabled = true;
    progressBar.classList.add('show');

    try {
        let fileKey = '';
        let mobileFileKey = '';

        // Загружаем ПК файл
        if (file) {
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Получение URL...';
            const urlRes = await fetch('/api/presigned-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream', version: 'pc' })
            });
            if (!urlRes.ok) throw new Error('Ошибка получения URL');
            const { url, key } = await urlRes.json();
            fileKey = key;

            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('PUT', url, true);
                xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        progressFill.style.width = percent + '%';
                        progressFill.textContent = percent + '%';
                        submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ПК: ${percent}%`;
                    }
                };
                xhr.onload = () => xhr.status === 200 ? resolve() : reject(new Error('Ошибка: ' + xhr.status));
                xhr.onerror = () => reject(new Error('Ошибка сети'));
                xhr.send(file);
            });
        }

        // Загружаем мобильный файл
        if (mobileFile) {
            progressFill.style.width = '0%';
            const urlRes = await fetch('/api/presigned-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: mobileFile.name, contentType: mobileFile.type || 'application/octet-stream', version: 'mobile' })
            });
            if (!urlRes.ok) throw new Error('Ошибка получения URL (мобильный)');
            const { url, key } = await urlRes.json();
            mobileFileKey = key;

            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('PUT', url, true);
                xhr.setRequestHeader('Content-Type', mobileFile.type || 'application/octet-stream');
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        progressFill.style.width = percent + '%';
                        progressFill.textContent = percent + '%';
                        submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 📱: ${percent}%`;
                    }
                };
                xhr.onload = () => xhr.status === 200 ? resolve() : reject(new Error('Ошибка: ' + xhr.status));
                xhr.onerror = () => reject(new Error('Ошибка сети'));
                xhr.send(mobileFile);
            });
        }

        // Сохраняем проект
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
        const formData = new FormData();
        formData.append('name', name);
        formData.append('description', description);
        formData.append('fileKey', fileKey);
        formData.append('mobileFileKey', mobileFileKey);
        formData.append('originalName', file?.name || mobileFile?.name);
        formData.append('fileSize', file?.size || 0);
        formData.append('mobileFileSize', mobileFile?.size || 0);
        if (previewFile) formData.append('preview', previewFile);

        const saveRes = await fetch('/api/save-project', { method: 'POST', body: formData });
        const result = await saveRes.json();

        if (result.success) {
            document.getElementById('uploadForm').reset();
            document.getElementById('fileInfo').classList.remove('show');
            document.getElementById('previewThumb').classList.remove('show');
            progressBar.classList.remove('show');
            progressFill.style.width = '0%';
            showNotification('✅ Файл загружен успешно!', 'success');
        } else {
            throw new Error(result.error || 'Ошибка сохранения');
        }
    } catch (error) {
        showNotification('❌ ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-upload"></i> Загрузить файл';
    }
});

// Добавление ссылки
document.getElementById('linkForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const button = e.target.querySelector('button[type="submit"]');
    const originalText = button.innerHTML;
    
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Добавление...';
    button.disabled = true;

    try {
        const response = await fetch('/api/link', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            e.target.reset();
            showNotification('✅ Ссылка добавлена!', 'success');
        } else {
            showNotification('❌ ' + result.error, 'error');
        }
    } catch (error) {
        showNotification('❌ Ошибка добавления', 'error');
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
});

async function loadAdminProjects() {
    try {
        const response = await fetch('/api/projects');
        const projects = await response.json();
        displayAdminProjects(projects);
    } catch (error) {
        console.error('Ошибка:', error);
    }
}

function displayAdminProjects(projects) {
    const container = document.getElementById('adminProjectsList');
    
    if (projects.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #666; padding: 40px;">Нет проектов</div>';
        return;
    }

    container.innerHTML = projects.map(project => {
        const isFile = project.type === 'file';
        const size = isFile ? formatFileSize(project.file_size) : 'Ссылка';
        
        let previewHtml;
        if (project.preview_path) {
            previewHtml = `<img src="${project.preview_path}" alt="">`;
        } else {
            const icon = isFile ? getFileIcon(project.original_name) : 'fa-link';
            previewHtml = `<i class="fas ${icon}"></i>`;
        }

        return `
            <div class="admin-project-card">
                <div class="admin-project-header">
                    <div class="admin-project-preview">
                        ${previewHtml}
                    </div>
                    <div class="admin-project-info">
                        <h3>${escapeHtml(project.name)}</h3>
                        <p>${escapeHtml(project.description || 'Без описания')}</p>
                        <div class="project-meta">
                            <span>${isFile ? '📁 ' + project.original_name : '🔗 Ссылка'}</span>
                            <span>📊 ${size}</span>
                            <span>⬇️ ${project.downloads || 0}</span>
                            <span>📅 ${new Date(project.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>
                <div class="admin-actions">
                    <button class="btn-edit" onclick="editProject('${project.id}')">
                        <i class="fas fa-edit"></i> Редактировать
                    </button>
                    <button class="btn-delete" onclick="deleteProject('${project.id}')">
                        <i class="fas fa-trash"></i> Удалить
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

let editingProject = null;

function editProject(id) {
    fetch('/api/projects').then(r => r.json()).then(projects => {
        const project = projects.find(p => p.id === id);
        if (!project) return;
        
        editingProject = project;
        
        document.getElementById('editId').value = project.id;
        document.getElementById('editName').value = project.name;
        document.getElementById('editDescription').value = project.description || '';
        
        const urlGroup = document.getElementById('editUrlGroup');
        if (project.type === 'link') {
            urlGroup.style.display = 'block';
            document.getElementById('editUrl').value = project.link_url || '';
        } else {
            urlGroup.style.display = 'none';
        }
        
        const previewDiv = document.getElementById('currentPreview');
        if (project.preview_path) {
            previewDiv.innerHTML = `<img src="${project.preview_path}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px;">`;
        } else {
            const icon = project.type === 'file' ? getFileIcon(project.original_name) : 'fa-link';
            previewDiv.innerHTML = `<i class="fas ${icon}"></i>`;
        }
        
        document.getElementById('editModal').classList.add('show');
    });
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('show');
    editingProject = null;
}

document.getElementById('editForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('editId').value;
    const formData = new FormData();
    formData.append('name', document.getElementById('editName').value);
    formData.append('description', document.getElementById('editDescription').value);
    
    const url = document.getElementById('editUrl').value;
    if (url) formData.append('url', url);
    
    const previewFile = document.getElementById('editPreview').files[0];
    if (previewFile) formData.append('preview', previewFile);

    try {
        const response = await fetch(`/api/projects/${id}`, {
            method: 'PUT',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeEditModal();
            showNotification('✅ Изменения сохранены!', 'success');
        } else {
            showNotification('❌ ' + result.error, 'error');
        }
    } catch (error) {
        showNotification('❌ Ошибка сохранения', 'error');
    }
});

async function deleteProject(id) {
    if (!confirm('❓ Удалить этот проект?')) return;

    try {
        const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
        const result = await response.json();
        
        if (result.success) {
            showNotification('✅ Удалено!', 'success');
        } else {
            showNotification('❌ ' + result.error, 'error');
        }
    } catch (error) {
        showNotification('❌ Ошибка удаления', 'error');
    }
}

function formatFileSize(bytes) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(text, type) {
    const div = document.createElement('div');
    div.className = `notification ${type}`;
    div.innerHTML = text;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

socket.on('new_project', () => loadAdminProjects());
socket.on('delete_project', () => loadAdminProjects());
socket.on('update_project', () => loadAdminProjects());

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('show');
    }
}

checkAdminAuth();