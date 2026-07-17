// Soymilk Job Hub - Frontend Logic

let allJobs = [];
let activeFilename = null;
const DEFAULT_GAS_API_URL = "https://script.google.com/macros/s/AKfycbzmy9L28j0SnaECOBMzzLBB-THahSqEu7b4uF8zU2tU7rSt6OLNZ-effc5idR3BAGY6/exec";
let localGasUrl = localStorage.getItem('gas_api_url');
// 自動防呆：如果 localStorage 中存有舊版（不含最新 API 特徵）的網址，一律強制清空回退
if (localGasUrl && !localGasUrl.includes("AKfycbzmy9L28j0SnaECOBMzzLBB-THahSqEu7b4uF8zU2tU7rSt6OLNZ-effc5idR3BAGY6")) {
    localStorage.removeItem('gas_api_url');
    localGasUrl = null;
}
// 確保 localStorage 中的值是合法的 http/https 連結，否則一律退回 DEFAULT_GAS_API_URL
let gasApiUrl = (localGasUrl && localGasUrl.trim().startsWith('http')) ? localGasUrl.trim() : DEFAULT_GAS_API_URL;

// DOM Elements
const syncBtn = document.getElementById('sync-btn');
const sidebar = document.getElementById('detail-sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');
const cancelBtn = document.getElementById('cancel-btn');
const editForm = document.getElementById('edit-form');

// 側邊欄欄位
const editFilenameInput = document.getElementById('edit-filename');
const editTitle = document.getElementById('edit-title');
const editPdfLink = document.getElementById('edit-pdf-link');
const editPdfName = document.getElementById('edit-pdf-name');
const formStatus = document.getElementById('form-status');
const formTag = document.getElementById('form-tag');
const formCompensation = document.getElementById('form-compensation');
const formContact = document.getElementById('form-contact');
const formShootDate = document.getElementById('form-shoot-date');
const formNote = document.getElementById('form-note');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    injectConfigButton();
    fetchJobs();
    setupEventListeners();
    setupDragAndDrop();
});

// 動態在 Header 注入雲端設定按鈕
function injectConfigButton() {
    const actionArea = document.querySelector('.action-area');
    if (actionArea) {
        const configBtn = document.createElement('button');
        configBtn.id = 'config-btn';
        configBtn.className = 'btn btn-secondary';
        configBtn.style.marginRight = '8px';
        configBtn.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <span>Google 雲端設定</span>
        `;
        actionArea.insertBefore(configBtn, syncBtn);

        configBtn.addEventListener('click', () => {
            const currentUrl = localStorage.getItem('gas_api_url') || "";
            const newUrl = prompt("請輸入您的 Google Apps Script 網頁應用程式網址：\n(留空將切換回本地單機模式)", currentUrl);
            if (newUrl !== null) {
                const trimmedUrl = newUrl.trim();
                localStorage.setItem('gas_api_url', trimmedUrl);
                gasApiUrl = trimmedUrl;
                alert(trimmedUrl ? "雲端同步已啟用！將自動讀寫 Google Sheets。" : "已切換回本地單機模式。");
                fetchJobs();
            }
        });
    }
}

// 設置基本事件監聽
function setupEventListeners() {
    // 同步按鈕
    syncBtn.addEventListener('click', async () => {
        if (gasApiUrl) {
            alert("目前處於雲端模式。請在您的筆電上執行「啟動接案管理.bat」來自動掃描並同步 PDF 檔案至 Google Sheets。");
            return;
        }

        setSyncLoading(true);
        try {
            const response = await fetch('/api/sync', { method: 'POST' });
            if (response.ok) {
                allJobs = await response.json();
                renderBoard(allJobs);
            } else {
                alert('同步失敗');
            }
        } catch (error) {
            console.error('Sync error:', error);
            alert('網路錯誤，無法同步');
        } finally {
            setSyncLoading(false);
        }
    });

    // 關閉側邊欄
    closeSidebarBtn.addEventListener('click', closeSidebar);
    cancelBtn.addEventListener('click', closeSidebar);

    // 表單儲存
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const filename = editFilenameInput.value;
        const updatedData = {
            filename: filename,
            status: formStatus.value,
            tag: formTag.value.trim(),
            compensation: formCompensation.value.trim(),
            contact: formContact.value.trim(),
            shoot_date: formShootDate.value,
            note: formNote.value.trim()
        };

        const originalJob = allJobs.find(j => j.filename === filename);
        if (originalJob && originalJob.pdf_url) {
            updatedData.pdf_url = originalJob.pdf_url;
        }

        if (gasApiUrl) {
            try {
                await fetch(gasApiUrl, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: JSON.stringify({
                        action: 'update_one',
                        job: updatedData
                    })
                });
                
                const idx = allJobs.findIndex(j => j.filename === filename);
                if (idx !== -1) {
                    allJobs[idx] = { ...allJobs[idx], ...updatedData };
                }
                renderBoard(allJobs);
                closeSidebar();
            } catch (error) {
                console.error('Cloud update error:', error);
                alert('雲端更新失敗，請檢查網路連線');
            }
        } else {
            try {
                const response = await fetch('/api/jobs/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedData)
                });

                if (response.ok) {
                    const idx = allJobs.findIndex(j => j.filename === filename);
                    if (idx !== -1) {
                        allJobs[idx] = { ...allJobs[idx], ...updatedData };
                    }
                    renderBoard(allJobs);
                    closeSidebar();
                } else {
                    alert('更新失敗');
                }
            } catch (error) {
                console.error('Update error:', error);
                alert('網路錯誤，無法儲存');
            }
        }
    });
}

// 取得所有案子
async function fetchJobs() {
    if (gasApiUrl) {
        try {
            const response = await fetch(gasApiUrl);
            if (response.ok) {
                allJobs = await response.json();
                renderBoard(allJobs);
            }
        } catch (error) {
            console.error('Error fetching cloud jobs:', error);
            alert('無法連線到 Google 雲端資料庫，請檢查您的 Apps Script 網址是否正確。');
        }
    } else {
        try {
            const response = await fetch('/api/jobs');
            if (response.ok) {
                allJobs = await response.json();
                renderBoard(allJobs);
            }
        } catch (error) {
            console.error('Error fetching local jobs:', error);
        }
    }
}

// 設置同步中狀態
function setSyncLoading(isLoading) {
    if (isLoading) {
        syncBtn.disabled = true;
        syncBtn.querySelector('span').textContent = '同步中...';
        syncBtn.querySelector('svg').classList.add('loading-spin');
    } else {
        syncBtn.disabled = false;
        syncBtn.querySelector('span').textContent = '同步資料夾';
        syncBtn.querySelector('svg').classList.remove('loading-spin');
    }
}

// 渲染看板
function renderBoard(jobs) {
    const columns = {
        pending: { cards: document.getElementById('cards-pending'), count: document.getElementById('count-pending'), items: [] },
        in_progress: { cards: document.getElementById('cards-in_progress'), count: document.getElementById('count-in_progress'), items: [] },
        confirmed: { cards: document.getElementById('cards-confirmed'), count: document.getElementById('count-confirmed'), items: [] },
        closed: { cards: document.getElementById('cards-closed'), count: document.getElementById('count-closed'), items: [] }
    };

    // 清空舊卡片
    Object.values(columns).forEach(col => {
        col.cards.innerHTML = '';
    });

    // 歸類 (排除已封存 archived)
    jobs.forEach(job => {
        if (job.status !== 'archived' && columns[job.status]) {
            columns[job.status].items.push(job);
        }
    });

    // 渲染卡片與數量
    Object.keys(columns).forEach(status => {
        const col = columns[status];
        col.count.textContent = col.items.length;

        // 如果該狀態底下沒有案子，顯示一個提示虛線框或留空
        if (col.items.length === 0) {
            col.cards.innerHTML = `<div class="empty-column-placeholder">拖曳卡片至此</div>`;
        }

        col.items.forEach(job => {
            const card = createJobCard(job);
            col.cards.appendChild(card);
        });
    });
}

// 創建單一卡片 DOM
function createJobCard(job) {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-filename', job.filename);

    // 標題與標籤
    let tagHTML = job.tag ? `<span class="card-tag">${escapeHTML(job.tag)}</span>` : '';
    
    // 元數據 (稿酬、備註前幾字)
    let metaHTML = '';
    if (job.compensation || job.shoot_date || job.note) {
        metaHTML = `<div class="card-meta">`;
        if (job.compensation) {
            metaHTML += `
                <div class="meta-item">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="1" x2="12" y2="23"></line>
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                    <span class="font-mono">${escapeHTML(job.compensation)}</span>
                </div>
            `;
        }
        if (job.shoot_date) {
            metaHTML += `
                <div class="meta-item">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <span class="font-mono">${escapeHTML(job.shoot_date)}</span>
                </div>
            `;
        }
        if (job.note) {
            const truncatedNote = job.note.length > 25 ? job.note.substring(0, 25) + '...' : job.note;
            metaHTML += `
                <div class="meta-item">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9"></path>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                    </svg>
                    <span>${escapeHTML(truncatedNote)}</span>
                </div>
            `;
        }
        metaHTML += `</div>`;
    }

    card.innerHTML = `
        ${tagHTML}
        <div class="card-title">${escapeHTML(job.title)}</div>
        ${metaHTML}
    `;

    // 點擊事件：打開側邊欄
    card.addEventListener('click', () => openSidebar(job));

    return card;
}

// 開啟側邊編輯欄
function openSidebar(job) {
    activeFilename = job.filename;
    
    editFilenameInput.value = job.filename;
    editTitle.textContent = job.title;
    editPdfName.textContent = job.filename;
    
    // 如果有雲端 PDF 網址，優先使用；若無則使用本地 API
    if (job.pdf_url) {
        editPdfLink.href = job.pdf_url;
    } else {
        editPdfLink.href = `/pdf/${encodeURIComponent(job.filename)}`;
    }
    
    formStatus.value = job.status;
    formTag.value = job.tag || '';
    formCompensation.value = job.compensation || '';
    formContact.value = job.contact || '';
    formShootDate.value = job.shoot_date || '';
    formNote.value = job.note || '';

    sidebar.classList.add('open');
}

// 關閉側邊欄
function closeSidebar() {
    sidebar.classList.remove('open');
    activeFilename = null;
}

// 設置拖放行為
function setupDragAndDrop() {
    let draggedFilename = null;

    document.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.job-card');
        if (card) {
            draggedFilename = card.getAttribute('data-filename');
            card.classList.add('dragging');
        }
    });

    document.addEventListener('dragend', (e) => {
        const card = e.target.closest('.job-card');
        if (card) {
            card.classList.remove('dragging');
        }
    });

    // 欄位放置事件
    const columns = document.querySelectorAll('.board-column');
    columns.forEach(col => {
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            if (!draggedFilename) return;

            const targetStatus = col.getAttribute('data-status');
            const job = allJobs.find(j => j.filename === draggedFilename);
            
            if (job && job.status !== targetStatus) {
                const updatedJob = { ...job, status: targetStatus };
                
                if (gasApiUrl) {
                    try {
                        await fetch(gasApiUrl, {
                            method: 'POST',
                            mode: 'no-cors',
                            body: JSON.stringify({
                                action: 'update_one',
                                job: updatedJob
                            })
                        });
                        job.status = targetStatus;
                        renderBoard(allJobs);
                    } catch (error) {
                        console.error('Cloud drop update error:', error);
                    }
                } else {
                    try {
                        const response = await fetch('/api/jobs/update', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                filename: draggedFilename,
                                status: targetStatus
                            })
                        });

                        if (response.ok) {
                            job.status = targetStatus;
                            renderBoard(allJobs);
                        } else {
                            alert('更新狀態失敗');
                        }
                    } catch (error) {
                        console.error('Drop update error:', error);
                    }
                }
            }
            draggedFilename = null;
        });
    });
}

// 安全字串轉換
function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
