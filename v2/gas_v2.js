/**
 * 豆漿接案表 v2 — Google Apps Script
 * 貼進試算表的「延伸功能 → Apps Script」，部署成網頁應用程式（執行身分：我；存取：任何人）。
 *
 * 動作：
 *   GET  ?action=get_all              讀 v2 分頁全部（前台平常用 gviz 讀，這條是備用；有設通行碼時關閉）
 *   POST {action:'add',      who, job}  新增一筆，回 {ok, id}
 *   POST {action:'update',   who, job}  依 id 改一筆，回 {ok, id}
 *   POST {action:'add_many', who, jobs} 批次新增（sync_pdf.py 匯入用），依 pdf_url 去重，回 {ok, added, skipped}
 *   POST {action:'get_all'}             讀全部
 *   在編輯器直接執行 migrateFromV1()    把第一個分頁（舊版）搬成「v2」分頁，跑一次就好，可重跑（會先清掉 v2 再搬）
 *
 * 部署一次就不再動。之後改版只改前台 index.html。
 */

// ★ 通行碼
//   這個檔案會上 GitHub（公開），所以這裡永遠留空，不要把密碼打在這一行。
//   密碼只打在兩個地方，兩個都不會外流：
//     (1) Apps Script 編輯器裡你貼上去的那份，把下面的 '' 中間填上；或
//     (2) 專案設定 → 指令碼屬性 → 新增屬性，名稱 KEY，值填密碼（更好，改密碼不用重新部署）
//   留空且沒設指令碼屬性 = 不檢查，任何拿到部署網址的人都能讀寫。
var KEY = '';

function key_(){
  try{
    var p = PropertiesService.getScriptProperties().getProperty('KEY');
    if(p) return String(p);
  }catch(e){}
  return KEY;
}

var TAB = 'v2';
var TZ = 'Asia/Taipei';
var HEADERS = ['id','title','status','source','tag','shoot_date','location','contact','pay_type','pay_amount','deliverable','due_deliver','due_publish','post_url','raw_message','note','pdf_url','created_at','updated_at','updated_by'];
var TEXT_COLS = ['id','shoot_date','due_deliver','due_publish','created_at','updated_at','pay_amount','contact']; // 這些欄位強制純文字，防止 Google 自動轉日期／數字

function out_(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function now_(){ return Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm'); }
function today_(){ return Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'); }

function sheet_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB);
  if(!sh){
    sh = ss.insertSheet(TAB);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    formatText_(sh, 2, Math.max(sh.getMaxRows()-1, 1));
  }
  return sh;
}
function formatText_(sh, row, n){
  if(n < 1) return;
  TEXT_COLS.forEach(function(c){ var i = HEADERS.indexOf(c); if(i >= 0) sh.getRange(row, i+1, n, 1).setNumberFormat('@'); });
}
function readAll_(sh){
  var data = sh.getDataRange().getValues();
  if(data.length <= 1) return [];
  var hdr = data[0].map(String);
  var rows = [];
  for(var i = 1; i < data.length; i++){
    var o = {};
    for(var j = 0; j < hdr.length; j++){ o[hdr[j]] = cell_(data[i][j]); }
    if(o.id) rows.push(o);
  }
  return rows;
}
function cell_(v){
  if(v === null || v === undefined) return '';
  if(v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy/MM/dd HH:mm');
  return String(v);
}
function newId_(sh){
  var prefix = 'J' + today_().slice(0,4) + '-' + today_().slice(4) + '-';
  var ids = sh.getRange(2, 1, Math.max(sh.getLastRow()-1, 1), 1).getValues().map(function(r){ return String(r[0]); });
  var n = 0;
  ids.forEach(function(id){ if(id.indexOf(prefix) === 0){ var k = parseInt(id.slice(prefix.length), 10); if(k > n) n = k; } });
  return prefix + ('0' + (n+1)).slice(-2);
}

function doGet(e){
  // 有設通行碼就不開放 GET 讀取；讀取請走 POST get_all
  if(key_()) return out_({ok:false, error:'use POST'});
  var sh = sheet_();
  return out_(readAll_(sh));
}

function doPost(e){
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    var body = JSON.parse(e.postData.contents || '{}');
    var action = body.action;
    var K = key_();
    if(K && String(body.key || '') !== K) return out_({ok:false, error:'bad key'});
    var who = String(body.who || '');
    var job = body.job || {};
    var sh = sheet_();

    if(action === 'add'){
      var id = newId_(sh);
      job.id = id;
      job.created_at = job.created_at || now_();
      job.updated_at = now_();
      job.updated_by = who;
      if(!job.status) job.status = 'inquiry';
      var row = HEADERS.map(function(h){ return job[h] == null ? '' : String(job[h]); });
      sh.appendRow(row);
      formatText_(sh, sh.getLastRow(), 1);
      return out_({ok:true, id:id});
    }

    if(action === 'update'){
      if(!job.id) return out_({ok:false, error:'no id'});
      var last = sh.getLastRow();
      if(last < 2) return out_({ok:false, error:'empty'});
      var ids = sh.getRange(2, 1, last-1, 1).getValues();
      for(var i = 0; i < ids.length; i++){
        if(String(ids[i][0]) === String(job.id)){
          var r = i + 2;
          job.updated_at = now_();
          job.updated_by = who;
          formatText_(sh, r, 1);
          var vals = HEADERS.map(function(h){ return job[h] == null ? '' : String(job[h]); });
          sh.getRange(r, 1, 1, HEADERS.length).setValues([vals]);
          return out_({ok:true, id:job.id});
        }
      }
      return out_({ok:false, error:'not found'});
    }

    // 批次匯入（sync_pdf.py 用）。依 pdf_url（＝PDF 檔名）比對：
    //   對得上 → 只補「原本是空的」欄位，絕不蓋掉你們手打過的東西
    //   對不上 → 新增一筆
    if(action === 'add_many' || action === 'upsert_many'){
      var jobs = body.jobs || [];
      if(!jobs.length) return out_({ok:true, added:0, filled:0, untouched:0});

      var last0 = sh.getLastRow();
      var all = (last0 >= 2) ? sh.getRange(2, 1, last0-1, HEADERS.length).getValues() : [];
      var pcol = HEADERS.indexOf('pdf_url');
      var index = {};
      for(var x = 0; x < all.length; x++){
        var key = String(all[x][pcol]).trim();
        if(key) index[key] = x;                  // x = 相對列號（0 起算）
      }

      var prefix = 'J' + today_().slice(0,4) + '-' + today_().slice(4) + '-';
      var base = 0;
      for(var y = 0; y < all.length; y++){
        var s = String(all[y][0]);
        if(s.indexOf(prefix) === 0){ var k = parseInt(s.slice(prefix.length), 10); if(k > base) base = k; }
      }

      var rows = [], added = 0, filled = 0, untouched = 0;
      var KEEP = ['id','status','created_at','updated_at','updated_by'];   // 這幾欄匯入永遠不碰
      for(var i = 0; i < jobs.length; i++){
        var job = jobs[i];
        var pk = String(job.pdf_url || '').trim();

        if(pk && index.hasOwnProperty(pk)){
          var r = index[pk];
          var cur = all[r], changed = false;
          for(var c = 0; c < HEADERS.length; c++){
            var h = HEADERS[c];
            if(KEEP.indexOf(h) !== -1) continue;
            var nv = (job[h] == null) ? '' : String(job[h]);
            if(nv && !String(cur[c]).trim()){ cur[c] = nv; changed = true; }
          }
          if(changed){
            cur[HEADERS.indexOf('updated_at')] = now_();
            cur[HEADERS.indexOf('updated_by')] = (who || 'PDF匯入');
            formatText_(sh, r + 2, 1);
            sh.getRange(r + 2, 1, 1, HEADERS.length).setValues([cur]);
            filled++;
          } else {
            untouched++;
          }
          continue;
        }

        base++;
        job.id = prefix + ('0' + base).slice(-2);
        job.created_at = job.created_at || now_();
        job.updated_at = now_();
        job.updated_by = who || 'PDF匯入';
        if(!job.status) job.status = 'inquiry';
        if(!job.source) job.source = '報名';
        if(pk) index[pk] = all.length + rows.length;
        rows.push(HEADERS.map(function(h){ return job[h] == null ? '' : String(job[h]); }));
        added++;
      }
      if(rows.length){
        var start = sh.getLastRow() + 1;
        formatText_(sh, start, rows.length);
        sh.getRange(start, 1, rows.length, HEADERS.length).setValues(rows);
      }
      return out_({ok:true, added:added, filled:filled, untouched:untouched});
    }

    if(action === 'get_all'){ return out_(readAll_(sh)); }
    return out_({ok:false, error:'unknown action'});
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
   搬家：第一個分頁（舊版 filename/title/tag/status/…）→ v2 分頁

   ★ migrateFromV1() 只在 v2 是空的時候才會動手。
     v2 已經有資料 → 直接擋下來，不會蓋掉你們後來改的東西。
     真的要重搬，執行 migrateFromV1_REDO()，它會先把現在的 v2 另存成
     「v2_備份_日期時間」分頁，再重搬。備份分頁不會被任何程式碰到。

   ★ 我（Claude）之後更新 gas_v2.js 時，你只要「重貼程式碼 + 重新部署」，
     不要再跑搬家。搬家一輩子只需要成功一次。
   ============================================================ */
function migrateFromV1(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var exist = ss.getSheetByName(TAB);
  if(exist && exist.getLastRow() > 1){
    throw new Error(
      'v2 分頁已經有 ' + (exist.getLastRow() - 1) + ' 筆資料，搬家取消（避免蓋掉你們後來改的內容）。' +
      '真的要重搬請改執行 migrateFromV1_REDO()，它會先自動備份。');
  }
  return doMigrate_();
}

/** 重搬：先備份現有 v2，再整個重來。只有真的要放棄現有 v2 才用。 */
function migrateFromV1_REDO(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var exist = ss.getSheetByName(TAB);
  if(exist && exist.getLastRow() > 1){
    var name = 'v2_備份_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmm');
    exist.copyTo(ss).setName(name);
    Logger.log('已備份現有 v2 到分頁「' + name + '」');
  }
  return doMigrate_();
}

function doMigrate_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheets()[0];
  if(src.getName() === TAB) throw new Error('第一個分頁就是 v2，找不到舊資料');
  var data = src.getDataRange().getValues();
  if(data.length <= 1) throw new Error('舊分頁沒有資料');
  var hdr = data[0].map(String);
  var col = function(name){ return hdr.indexOf(name); };
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd');

  var seen = {};       // 合併重複 PDF：同樣標題（去掉 (2)、(3)、尾數）只留最早一筆
  var rows = [];
  var seq = 0;
  for(var i = 1; i < data.length; i++){
    var r = data[i];
    var get = function(name){ var k = col(name); return k < 0 ? '' : cell_(r[k]); };
    var filename = get('filename'), title = get('title');
    if(!filename && !title) continue;
    var status1 = get('status') || 'pending';
    var shoot = normDate_(get('shoot_date'));
    var created = normDate_(get('created_at'));
    var comp = get('compensation').trim();
    var note = get('note');
    var isPdf = /\.pdf$/i.test(filename);

    var status;
    if(status1 === 'pending') status = 'inquiry';
    else if(status1 === 'in_progress') status = (shoot && shoot.slice(0,10) < today) ? 'to_deliver' : 'scheduled';
    else if(status1 === 'confirmed') status = 'done';
    else status = 'declined';

    var num = comp.replace(/,/g,'').match(/\d+(\.\d+)?/);
    var mutual = /互惠|無酬|免費/.test(comp);
    var payType = (num && mutual) ? '兩者' : (num ? '有酬' : (mutual ? '互惠' : '未定'));
    var leftover = comp.replace(/[\d,\s$元NT.]/g,'').replace(/互惠|有酬|邀約|｜|\|/g,'');
    var note2 = (comp && (leftover || (!num && !mutual))) ? '報酬（原文）：' + comp : '';

    // 同一份報名表被存過好幾次（「… (2).pdf」「… (3).pdf」）只留一筆
    var pkey = isPdf ? pdfKey_(filename) : '';
    if(isPdf && status === 'inquiry'){
      if(seen[pkey]){ continue; }
      seen[pkey] = true;
    }

    seq++;
    var cdate = (created || today).slice(0,10).replace(/\//g,'');
    var id = 'J' + cdate.slice(0,4) + '-' + cdate.slice(4) + '-' + ('0' + seq).slice(-2);

    rows.push([
      id, title || filename, status, isPdf ? '報名' : '邀約',
      (get('tag') && get('tag') !== '一般') ? get('tag') : '',
      shoot, extractAddress_(note), get('contact'), payType, num ? num[0] : '',
      get('platform'), '', '', '', note, note2,
      // pdf_url 改存「本機檔名（去掉 .pdf 和 (2)(3)）」，不再存 catbox 公開網址：
      // (1) 之後 sync_pdf.py 靠這個認得出同一份，會把 PDF 內容補進這一列
      // (2) 個資不再指向公開圖床
      pkey,
      created, now_(), '搬家'
    ]);
  }

  var sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
  sh.clear();
  sh.appendRow(HEADERS);
  sh.setFrozenRows(1);
  if(rows.length){
    formatText_(sh, 2, rows.length);
    sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }
  Logger.log('搬完 ' + rows.length + ' 筆（舊分頁 ' + (data.length-1) + ' 列，重複的報名表已合併）');
  Logger.log('提醒：以後更新程式碼只要重貼＋重新部署，不用再跑搬家。');
  return rows.length;
}

/* ============================================================
   修復：2026/09/20 PDF 匯入對錯，多出一批重複列

   狀況：早期的搬家把 catbox 網址存進 pdf_url，但 sync_pdf.py 是用
        「PDF 檔名」比對，兩邊對不上，89 份報名表被當成新案子加進去。

   這個函式做兩件事，跑一次就好：
     1. 刪掉那批誤加的列（id 是 J2026-0920-、pdf_url 是檔名而非網址）
     2. 把舊列的 pdf_url 從 catbox 網址換成 PDF 檔名
        （之後匯入才對得上；順便把公開圖床網址清出試算表）
   你手打的內容一律不動。跑之前建議先 檔案→版本記錄 看一眼。
   ============================================================ */
function repairAfterBadImport(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB);
  if(!sh) throw new Error('找不到 v2 分頁');

  var last = sh.getLastRow();
  if(last < 2) throw new Error('v2 分頁是空的');
  var idCol = HEADERS.indexOf('id');
  var pCol  = HEADERS.indexOf('pdf_url');
  var data  = sh.getRange(2, 1, last-1, HEADERS.length).getValues();

  // ── 1. 刪掉誤加的列（由下往上刪，列號才不會跑掉）
  var killed = 0;
  for(var i = data.length - 1; i >= 0; i--){
    var id = String(data[i][idCol]);
    var pu = String(data[i][pCol]).trim();
    if(id.indexOf('J2026-0920-') === 0 && pu && pu.indexOf('http') !== 0){
      sh.deleteRow(i + 2);
      killed++;
    }
  }
  Logger.log('刪掉誤加的列：' + killed + ' 筆');

  // ── 2. catbox 網址 → PDF 檔名
  var src = ss.getSheets()[0];
  if(src.getName() === TAB) throw new Error('找不到舊分頁');
  var old = src.getDataRange().getValues();
  var oh = old[0].map(String);
  var fi = oh.indexOf('filename'), ui = oh.indexOf('pdf_url');
  var map = {};
  if(fi >= 0 && ui >= 0){
    for(var r = 1; r < old.length; r++){
      var url = String(old[r][ui]).trim();
      var fn  = String(old[r][fi]).trim();
      if(url && fn && /\.pdf$/i.test(fn)) map[url] = pdfKey_(fn);
    }
  }

  last = sh.getLastRow();
  var fixed = 0, unmatched = 0;
  if(last >= 2){
    var col = sh.getRange(2, pCol + 1, last-1, 1);
    var vals = col.getValues();
    for(var k = 0; k < vals.length; k++){
      var v = String(vals[k][0]).trim();
      if(v.indexOf('http') !== 0) continue;
      if(map[v]){ vals[k][0] = map[v]; fixed++; }
      else { unmatched++; }
    }
    col.setNumberFormat('@');
    col.setValues(vals);
  }
  Logger.log('pdf_url 由網址換成檔名：' + fixed + ' 筆；對不到舊資料的：' + unmatched + ' 筆');
  Logger.log('現在 v2 共 ' + (sh.getLastRow() - 1) + ' 筆。接著可以重跑 sync_pdf.py。');
  return {deleted: killed, fixed: fixed, unmatched: unmatched, total: sh.getLastRow() - 1};
}

// PDF 的識別碼：去掉副檔名和「 (2)」「 (3)」。sync_pdf.py 用同一套規則。
function pdfKey_(filename){
  return String(filename || '').replace(/\.pdf$/i, '').replace(/\s*\(\d+\)\s*$/, '').trim();
}

function normDate_(v){
  if(!v) return '';
  var s = String(v).trim();
  var m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[T\s]+(.*))?$/);
  if(!m) return s;
  var pad = function(n){ return ('0' + n).slice(-2); };
  var out = m[1] + '/' + pad(m[2]) + '/' + pad(m[3]);
  var rest = (m[4] || '').trim();
  if(rest === '全天' || rest === '半天') return out + ' ' + rest;
  var t = rest.match(/^(\d{1,2}):(\d{2})/);
  if(t) return out + ' ' + pad(t[1]) + ':' + t[2];
  return out;
}
function extractAddress_(t){
  if(!t) return '';
  var m = String(t).match(/((?:臺|台)(?:北|中|南|東)市|(?:新北|桃園|新竹|嘉義|基隆|高雄)市|(?:新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|臺東|台東|金門|澎湖)縣)[^\n\r,，。;；:：（）()\[\]]{2,40}?(?:號(?:之\d+)?(?:[\s,，]?\d+樓(?:之\d+)?)?|樓)/);
  return m ? m[0].trim() : '';
}
