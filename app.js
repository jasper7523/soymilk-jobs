// Soymilk Job Hub - Frontend Logic

let allJobs = [];
let activeFilename = null;
let inProgressSortOrder = 'asc'; // 'asc' = 舊→新, 'desc' = 新→舊
let pendingSortOrder = 'desc';   // 'asc' = 舊→新, 'desc' = 新→舊

// 從 localStorage 讀取設定（不再硬編碼任何敏感資訊）
let sheetId = localStorage.getItem('sheet_id') || "";
let gasApiUrl = localStorage.getItem('gas_api_url') || "";

// ─── 一鍵設定連結解析 ────────────────────────────────────
// 網址格式：https://xxx.github.io/jobs-dashboard/#s=試算表ID&g=GAS部署ID
// GAS 部署 ID = 完整網址中 /s/ 和 /exec 之間的那段
// 用法：你（開發者）組好連結私訊給豆漿，她打開即自動設定
function applySetupLink() {
    const hash = window.location.hash;
    if (!hash.includes('s=')) return false;

    try {
        const params = new URLSearchParams(hash.slice(1));
        const s = params.get('s');
        const g = params.get('g');

        if (s) {
            localStorage.setItem('sheet_id', s);
            sheetId = s;
        }
        if (g) {
            // 從部署 ID 重組完整 GAS URL
            const fullGasUrl = g.startsWith('https://')
                ? g
                : `https://script.google.com/macros/s/${g}/exec`;
            localStorage.setItem('gas_api_url', fullGasUrl);
            gasApiUrl = fullGasUrl;
        }

        // 清除 hash，避免書籤或分享時外洩
        history.replaceState(null, '', window.location.pathname + window.location.search);
        return true;
    } catch (e) {
        console.error('Setup link parse error:', e);
        return false;
    }
}

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
const formShootDateDay = document.getElementById('form-shoot-date-day');
const formShootDateType = document.getElementById('form-shoot-date-type');
const formShootDateTime = document.getElementById('form-shoot-date-time');
const formShootTimeGroup = document.getElementById('form-shoot-time-group');
const formNote = document.getElementById('form-note');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 優先偵測一鍵設定連結（hash fragment）
    const autoConfigured = applySetupLink();

    injectConfigButton();

    // 首次使用偵測：若無 sheet_id 則彈出設定 Modal
    if (!sheetId) {
        showSetupModal();
    } else {
        if (autoConfigured) {
            // 一鍵設定成功，顯示簡短提示
            showToast('設定完成！正在載入你的接案資料...');
        }
        fetchJobs();
    }

    setupEventListeners();
    setupDragAndDrop();

    // 排序切換按鈕 — 待執行
    const sortToggleBtn = document.getElementById('sort-toggle-btn');
    if (sortToggleBtn) {
        sortToggleBtn.addEventListener('click', () => {
            inProgressSortOrder = inProgressSortOrder === 'asc' ? 'desc' : 'asc';
            sortToggleBtn.querySelector('.sort-label').textContent = inProgressSortOrder === 'asc' ? '舊→新' : '新→舊';
            renderBoard(allJobs);
        });
    }

    // 排序切換按鈕 — 尚未回應
    const sortTogglePending = document.getElementById('sort-toggle-pending');
    if (sortTogglePending) {
        sortTogglePending.addEventListener('click', () => {
            pendingSortOrder = pendingSortOrder === 'asc' ? 'desc' : 'asc';
            sortTogglePending.querySelector('.sort-label').textContent = pendingSortOrder === 'asc' ? '舊→新' : '新→舊';
            renderBoard(allJobs);
        });
    }
});

// 簡易 Toast 提示
function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// ─── 首次設定 Modal ───────────────────────────────────────

function showSetupModal() {
    if (document.getElementById('setup-overlay')) {
        document.getElementById('setup-overlay').style.display = 'flex';
        // 回填目前的值
        document.getElementById('setup-sheet-id').value = sheetId;
        document.getElementById('setup-gas-url').value = gasApiUrl;
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'setup-overlay';
    overlay.className = 'setup-overlay';

    overlay.innerHTML = `
        <div class="setup-modal">
            <h2 class="setup-title">歡迎使用接案看板</h2>
            <p class="setup-subtitle">只需設定一次，之後都會自動連線</p>

            <div class="setup-step">
                <div class="step-number">1</div>
                <div class="step-content">
                    <label class="step-label" for="setup-sheet-id">你的 Google 試算表 ID</label>
                    <p class="step-hint">打開你的 Google 試算表，從網址列中複製 <code>d/</code> 和 <code>/edit</code> 之間的那串文字</p>
                    <div class="step-example"><span class="example-dim">https://docs.google.com/spreadsheets/d/</span><span class="example-highlight">這串就是ID</span><span class="example-dim">/edit</span></div>
                    <input type="text" id="setup-sheet-id" class="setup-input" placeholder="貼上 d/ 和 /edit 之間的那串文字" value="${sheetId}">
                </div>
            </div>

            <div class="setup-step">
                <div class="step-number">2</div>
                <div class="step-content">
                    <label class="step-label" for="setup-gas-url">你的 Apps Script 網址</label>
                    <p class="step-hint">在試算表「延伸功能 → Apps Script」部署後產生的網址（可留空，請管理員傳設定連結給你）</p>
                    <input type="text" id="setup-gas-url" class="setup-input" placeholder="https://script.google.com/macros/s/.../exec" value="${gasApiUrl}">
                </div>
            </div>

            <div id="setup-error" class="setup-error" style="display:none;"></div>
            <button id="setup-save-btn" class="setup-save-btn">開始使用</button>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('setup-save-btn').addEventListener('click', () => {
        const newSheetId = document.getElementById('setup-sheet-id').value.trim();
        const newGasUrl = document.getElementById('setup-gas-url').value.trim();
        const errorEl = document.getElementById('setup-error');

        if (!newSheetId || newSheetId.length < 10 || newSheetId.includes(' ')) {
            errorEl.textContent = '試算表 ID 格式不對，請確認是否正確複製';
            errorEl.style.display = 'block';
            return;
        }
        if (newGasUrl && !newGasUrl.startsWith('https://script.google.com/')) {
            errorEl.textContent = 'Apps Script 網址應以 https://script.google.com/ 開頭';
            errorEl.style.display = 'block';
            return;
        }

        localStorage.setItem('sheet_id', newSheetId);
        localStorage.setItem('gas_api_url', newGasUrl);
        sheetId = newSheetId;
        gasApiUrl = newGasUrl;

        overlay.style.display = 'none';
        fetchJobs();
    });
}

// ─── Header 齒輪設定按鈕 ─────────────────────────────────

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
            <span>設定</span>
        `;
        actionArea.insertBefore(configBtn, syncBtn);

        configBtn.addEventListener('click', () => {
            showSetupModal();
        });
    }
}

// ─── 新增案件 Modal ──────────────────────────────────────

function showAddJobModal() {
    // 防重複建立
    if (document.getElementById('add-job-overlay')) {
        document.getElementById('add-job-overlay').style.display = 'flex';
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'add-job-overlay';
    overlay.className = 'setup-overlay';

    overlay.innerHTML = `
        <div class="setup-modal add-job-modal">
            <div class="add-modal-header">
                <h2 class="setup-title">新增案件</h2>
                <button id="add-job-close" class="btn-close" type="button">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <p class="setup-subtitle">直接在看板上建立新的接案卡片</p>

            <form id="add-job-form" class="add-job-form">
                <div class="form-group">
                    <label for="add-title">案件名稱 <span class="required-mark">*</span></label>
                    <input type="text" id="add-title" class="setup-input" placeholder="例如：XX 品牌 KOC 探店合作" required>
                </div>

                <div class="form-row-2">
                    <div class="form-group">
                        <label for="add-tag">類型標籤</label>
                        <input type="text" id="add-tag" class="setup-input" placeholder="KOC、探店、展覽...">
                    </div>
                    <div class="form-group">
                        <label for="add-status">初始狀態</label>
                        <select id="add-status" class="setup-input">
                            <option value="pending">尚未回應</option>
                            <option value="in_progress">待執行</option>
                            <option value="confirmed">合作成功</option>
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label for="add-compensation">稿酬 / 條件</label>
                    <input type="text" id="add-compensation" class="setup-input font-mono" placeholder="$5,000 + 互惠">
                </div>

                <div class="form-row-3">
                    <div class="form-group font-mono">
                        <label for="add-shoot-date-day">拍攝日期</label>
                        <input type="date" id="add-shoot-date-day" class="setup-input font-mono">
                    </div>
                    <div class="form-group">
                        <label for="add-shoot-date-type">時間類型</label>
                        <select id="add-shoot-date-type" class="setup-input">
                            <option value="all_day">全天</option>
                            <option value="half_day">半天</option>
                            <option value="specific_time">特定時間</option>
                        </select>
                    </div>
                    <div class="form-group font-mono" id="add-shoot-time-group" style="display:none;">
                        <label for="add-shoot-date-time">拍攝時間</label>
                        <input type="time" id="add-shoot-date-time" class="setup-input font-mono">
                    </div>
                </div>

                <div class="form-group">
                    <label for="add-contact">聯絡窗口</label>
                    <input type="text" id="add-contact" class="setup-input" placeholder="張小姐 / LINE: @brand123">
                </div>

                <div class="form-group">
                    <label for="add-platform">合作平台</label>
                    <input type="text" id="add-platform" class="setup-input" placeholder="IG Reels、小紅書、YouTube...">
                </div>

                <div class="form-group">
                    <label for="add-note">備忘錄</label>
                    <textarea id="add-note" class="setup-input" rows="3" placeholder="其他備註或對接細節..."></textarea>
                </div>

                <div id="add-job-error" class="setup-error" style="display:none;"></div>

                <div class="add-job-actions">
                    <button type="button" id="add-job-cancel" class="btn btn-secondary">取消</button>
                    <button type="submit" id="add-job-submit" class="btn btn-primary">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        <span>新增</span>
                    </button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(overlay);

    // 關閉按鈕
    const closeModal = () => { overlay.style.display = 'none'; };
    document.getElementById('add-job-close').addEventListener('click', closeModal);
    document.getElementById('add-job-cancel').addEventListener('click', closeModal);

    // 時間類型切換
    const addDateType = document.getElementById('add-shoot-date-type');
    const addTimeGroup = document.getElementById('add-shoot-time-group');
    if (addDateType && addTimeGroup) {
        addDateType.addEventListener('change', () => {
            if (addDateType.value === 'specific_time') {
                addTimeGroup.style.display = 'block';
            } else {
                addTimeGroup.style.display = 'none';
            }
        });
    }

    // 點擊背景關閉
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // 提交表單
    document.getElementById('add-job-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('add-job-error');
        const submitBtn = document.getElementById('add-job-submit');

        const title = document.getElementById('add-title').value.trim();
        if (!title) {
            errorEl.textContent = '案件名稱不能空白';
            errorEl.style.display = 'block';
            return;
        }

        // 組裝資料（created_at 自動帶入當前時間）
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const createdAt = `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const shootDateVal = composeShootDate('add-shoot-date-day', 'add-shoot-date-type', 'add-shoot-date-time');
        
        const newJob = {
            title: title,
            tag: document.getElementById('add-tag').value.trim(),
            status: document.getElementById('add-status').value,
            compensation: document.getElementById('add-compensation').value.trim(),
            shoot_date: shootDateVal,
            contact: document.getElementById('add-contact').value.trim(),
            platform: document.getElementById('add-platform').value.trim(),
            note: document.getElementById('add-note').value.trim(),
            created_at: createdAt
        };

        errorEl.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.querySelector('span').textContent = '新增中...';

        if (gasApiUrl) {
            try {
                await fetch(gasApiUrl, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: JSON.stringify({
                        action: 'add_one',
                        job: newJob
                    })
                });

                // no-cors 拿不到 response body，手動生成 filename
                const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
                newJob.filename = `WEB_${ts}.manual`;
                newJob.pdf_url = '';

                allJobs.push(newJob);
                renderBoard(allJobs);
                closeModal();

                // 清空表單
                document.getElementById('add-job-form').reset();
            } catch (error) {
                console.error('Add job error:', error);
                errorEl.textContent = '新增失敗，請檢查網路連線';
                errorEl.style.display = 'block';
            }
        } else {
            // 本地模式：呼叫 server API
            try {
                const response = await fetch('/api/jobs/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newJob)
                });

                if (response.ok) {
                    const result = await response.json();
                    newJob.filename = result.filename || `WEB_${Date.now()}.manual`;
                    newJob.created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
                    newJob.pdf_url = '';

                    allJobs.push(newJob);
                    renderBoard(allJobs);
                    closeModal();
                    document.getElementById('add-job-form').reset();
                } else {
                    errorEl.textContent = '新增失敗';
                    errorEl.style.display = 'block';
                }
            } catch (error) {
                console.error('Add job error:', error);
                errorEl.textContent = '網路錯誤，無法新增';
                errorEl.style.display = 'block';
            }
        }

        submitBtn.disabled = false;
        submitBtn.querySelector('span').textContent = '新增';
    });
}

// 設置基本事件監聽
function setupEventListeners() {
    // 新增案件按鈕
    const addJobBtn = document.getElementById('add-job-btn');
    if (addJobBtn) {
        addJobBtn.addEventListener('click', () => {
            if (!gasApiUrl && !sheetId) {
                alert('請先完成設定（點右上角齒輪）再新增案件。');
                return;
            }
            showAddJobModal();
        });
    }

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

    // 側邊欄時間類型切換
    if (formShootDateType && formShootTimeGroup) {
        formShootDateType.addEventListener('change', () => {
            if (formShootDateType.value === 'specific_time') {
                formShootTimeGroup.style.display = 'block';
            } else {
                formShootTimeGroup.style.display = 'none';
            }
        });
    }

    // 表單儲存
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const filename = editFilenameInput.value;
        const shootDateVal = composeShootDate('form-shoot-date-day', 'form-shoot-date-type', 'form-shoot-date-time');
        
        const updatedData = {
            filename: filename,
            status: formStatus.value,
            tag: formTag.value.trim(),
            compensation: formCompensation.value.trim(),
            contact: formContact.value.trim(),
            shoot_date: shootDateVal,
            created_at: document.getElementById('form-created-at').value,
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
    // 透過 Google Sheets Visualization API 直連讀取（無 302 重定向，iOS 全相容）
    if (sheetId) {
        try {
            const response = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&headers=1`);
            if (response.ok) {
                const text = await response.text();
                const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*?)\);/);
                if (match) {
                    const json = JSON.parse(match[1]);
                    const cols = json.table.cols.map(c => c.label || c.id || '');
                    
                    if (cols.length === 0) {
                        allJobs = [];
                    } else {
                        allJobs = json.table.rows.map(row => {
                            const item = {};
                            row.c.forEach((cell, idx) => {
                                const header = cols[idx];
                                if (header) {
                                    let val = cell ? (cell.v !== null && cell.v !== undefined ? String(cell.v) : "") : "";
                                    // 所有日期欄位統一正規化
                                    if ((header === 'shoot_date' || header === 'created_at') && val) {
                                        val = normalizeDate(val);
                                    }
                                    item[header] = val;
                                }
                            });
                            return item;
                        });
                    }
                    renderBoard(allJobs);
                    return;
                }
            }
        } catch (error) {
            console.error('Error fetching via Visualization API:', error);
        }
    }

    // Fallback：本地 API（僅限開發環境）
    try {
        const response = await fetch('/api/jobs');
        if (response.ok) {
            allJobs = await response.json();
            allJobs = allJobs.map(job => {
                if (job.shoot_date) job.shoot_date = normalizeDate(job.shoot_date);
                if (job.created_at) job.created_at = normalizeDate(job.created_at);
                return job;
            });
            renderBoard(allJobs);
        }
    } catch (error) {
        console.error('Error fetching local jobs:', error);
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
    // 待執行：按拍攝日期排序（方向可切換）
    columns['in_progress'].items.sort((a, b) => {
        const da = toSortableDate(a.shoot_date);
        const db = toSortableDate(b.shoot_date);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return inProgressSortOrder === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
    });
    // 尚未回應：按新增日期排序（方向可切換）
    columns['pending'].items.sort((a, b) => {
        const da = toSortableDate(a.created_at);
        const db = toSortableDate(b.created_at);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return pendingSortOrder === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
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
    if (job.compensation || job.shoot_date || job.created_at || job.note) {
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
                    <span class="font-mono">${escapeHTML(formatShootDate(job.shoot_date))}</span>
                </div>
            `;
        }
        if (job.created_at && !job.shoot_date) {
            metaHTML += `
                <div class="meta-item">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span class="font-mono">${escapeHTML(formatShootDate(job.created_at))}</span>
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
    const parsed = parseShootDate(job.shoot_date || '');
    if (formShootDateDay) formShootDateDay.value = parsed.day;
    if (formShootDateType) {
        formShootDateType.value = parsed.type;
        if (parsed.type === 'specific_time') {
            if (formShootTimeGroup) formShootTimeGroup.style.display = 'block';
            if (formShootDateTime) formShootDateTime.value = parsed.time;
        } else {
            if (formShootTimeGroup) formShootTimeGroup.style.display = 'none';
            if (formShootDateTime) formShootDateTime.value = '';
        }
    }
    const formCreatedAt = document.getElementById('form-created-at');
    if (formCreatedAt) formCreatedAt.value = toDatetimeLocalValue(job.created_at || '');
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

// ====== 日期與時間工具 ======

// 組合為人類可讀的格式 YYYY/MM/DD 半天 / YYYY/MM/DD 全天 / YYYY/MM/DD HH:mm
function composeShootDate(dayId, typeId, timeId) {
    const dayEl = document.getElementById(dayId);
    const typeEl = document.getElementById(typeId);
    const timeEl = document.getElementById(timeId);
    if (!dayEl) return '';
    const day = dayEl.value;
    const type = typeEl ? typeEl.value : 'all_day';
    const time = timeEl ? timeEl.value : '00:00';
    if (!day) return '';
    
    // 統一用 slash / 分隔
    const formattedDay = day.replace(/-/g, '/');
    
    if (type === 'all_day') {
        return `${formattedDay} 全天`;
    } else if (type === 'half_day') {
        return `${formattedDay} 半天`;
    } else {
        return `${formattedDay} ${time || '00:00'}`;
    }
}

// 解析各種日期時間格式為前台 UI 用的 day, type, time 物件
function parseShootDate(val) {
    const defaultVal = { day: '', type: 'all_day', time: '' };
    if (!val) return defaultVal;
    
    const str = String(val).trim();
    
    // 先做一次標準正規化
    const normalized = normalizeDate(str);
    if (!normalized) return defaultVal;
    
    // 1. 處理 YYYY/MM/DD 全天
    if (normalized.endsWith(' 全天')) {
        const day = normalized.replace(' 全天', '').replace(/\//g, '-');
        return { day, type: 'all_day', time: '' };
    }
    
    // 2. 處理 YYYY/MM/DD 半天
    if (normalized.endsWith(' 半天')) {
        const day = normalized.replace(' 半天', '').replace(/\//g, '-');
        return { day, type: 'half_day', time: '' };
    }
    
    // 3. 處理 YYYY/MM/DD HH:mm
    const dateTimeMatch = normalized.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
    if (dateTimeMatch) {
        const day = `${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}`;
        const time = `${dateTimeMatch[4]}:${dateTimeMatch[5]}`;
        return { day, type: 'specific_time', time };
    }
    
    // 4. 處理只有 YYYY/MM/DD 的情況
    const dateOnlyMatch = normalized.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (dateOnlyMatch) {
        const day = `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`;
        return { day, type: 'all_day', time: '' };
    }
    
    return defaultVal;
}

// 所有日期在載入與儲存時都先經過此函式，輸出統一為 YYYY/MM/DD HH:mm 或 YYYY/MM/DD 半天 / YYYY/MM/DD 全天
function normalizeDate(val) {
    if (!val) return '';
    const str = String(val).trim();
    
    // 1. Google Visualization API: Date(2026,6,22,14,0,0)  月份 0-indexed
    const gvizMatch = str.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+))?/);
    if (gvizMatch) {
        const y = gvizMatch[1];
        const m = String(Number(gvizMatch[2]) + 1).padStart(2, '0');
        const d = String(gvizMatch[3]).padStart(2, '0');
        const hh = gvizMatch[4] ? String(gvizMatch[4]).padStart(2, '0') : '00';
        const mm = gvizMatch[5] ? String(gvizMatch[5]).padStart(2, '0') : '00';
        return (hh === '00' && mm === '00') ? `${y}/${m}/${d}` : `${y}/${m}/${d} ${hh}:${mm}`;
    }
    
    // 2. ISO 格式: 2026-07-18T02:55:04.000Z 或 2026-07-22T14:00
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (isoMatch) {
        const [, y, m, d, hh, mm] = isoMatch;
        return (hh === '00' && mm === '00') ? `${y}/${m}/${d}` : `${y}/${m}/${d} ${hh}:${mm}`;
    }
    
    // 3. 帶有 hyphen 的半天/全天格式: 2026-07-22 半天
    const customMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(半天|全天)$/);
    if (customMatch) {
        return `${customMatch[1]}/${customMatch[2]}/${customMatch[3]} ${customMatch[4]}`;
    }
    
    // 4. 空格分隔帶時間: "2026-07-17 1:19" 或 "2026-07-17 14:00"
    const spaceMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
    if (spaceMatch) {
        const [, y, m, d, hh, mm] = spaceMatch;
        return `${y}/${m}/${d} ${String(hh).padStart(2, '0')}:${mm}`;
    }
    
    // 5. 純日期帶 hyphen: 2026-07-22
    const dateOnly = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
        return `${dateOnly[1]}/${dateOnly[2]}/${dateOnly[3]}`;
    }
    
    // 6. 已經是 YYYY/MM/DD 或帶有半天/全天後綴格式
    if (str.match(/^\d{4}\/\d{2}\/\d{2}/)) return str;
    
    return str;
}

// 顯示用
function formatShootDate(val) {
    return normalizeDate(val);
}

// 排序用：統一轉為 YYYY-MM-DD HH:mm 以利 localeCompare 排序
function toSortableDate(val) {
    const n = normalizeDate(val);
    if (!n) return '';
    let sortable = n.replace(/\//g, '-');
    if (sortable.endsWith(' 全天')) {
        return sortable.replace(' 全天', ' 00:00');
    }
    if (sortable.endsWith(' 半天')) {
        return sortable.replace(' 半天', ' 12:00');
    }
    if (sortable.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return sortable + ' 00:00';
    }
    return sortable;
}

// 表單回填用 (純日期或 ISO 等相容)
function toDatetimeLocalValue(val) {
    const n = normalizeDate(val);
    if (!n) return '';
    const m = n.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
    if (m) {
        const hh = m[4] || '00';
        const mm = m[5] || '00';
        return `${m[1]}-${m[2]}-${m[3]}T${hh}:${mm}`;
    }
    return '';
}
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
