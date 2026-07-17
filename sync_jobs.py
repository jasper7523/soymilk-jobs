import os
import re
import json
import urllib.request
import urllib.parse
import sys
import time
from datetime import datetime

SETTINGS_FILE = "settings.json"

def safe_print(message):
    try:
        print(message)
    except UnicodeEncodeError:
        try:
            # 嘗試使用系統 stdout 編碼並替換不支援字元
            enc = sys.stdout.encoding or 'utf-8'
            print(message.encode(enc, errors='replace').decode(enc))
        except Exception:
            # 退回到 cp950 忽略不支援字元
            print(message.encode('cp950', errors='ignore').decode('cp950'))

def get_gas_url():
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                config = json.load(f)
                return config.get("gas_api_url", "")
        except Exception:
            pass
    return ""

def upload_to_catbox(file_path):
    url = "https://catbox.moe/user/api.php"
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    
    filename = os.path.basename(file_path)
    # 淨化上傳時的檔名，只保留中文、英文、數字、點與減號/底線，移除 Emoji 及全型特殊符號防止 Catbox 後台解碼錯誤報 500
    safe_filename = "".join(c for c in filename if c.isalnum() or c in ".-_")
    if not safe_filename.lower().endswith(".pdf"):
        safe_filename += ".pdf"

    try:
        with open(file_path, "rb") as f:
            file_content = f.read()
    except Exception as e:
        safe_print(f"讀取 PDF 失敗: {e}")
        return ""
        
    safe_print(f"正在將簡章上傳至雲端分享 ({filename})...")
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="reqtype"\r\n\r\n'
        "fileupload\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="fileToUpload"; filename="{safe_filename}"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8") + file_content + f"\r\n--{boundary}--\r\n".encode("utf-8")
    
    req = urllib.request.Request(url, data=body)
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("User-Agent", "Mozilla/5.0")
    
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            result = response.read().decode("utf-8").strip()
            if result.startswith("http"):
                safe_print(f"上傳成功！雲端網址: {result}")
                return result
            else:
                safe_print(f"上傳失敗，Catbox 回傳: {result}")
                return ""
    except Exception as e:
        safe_print(f"上傳雲端失敗: {e}")
        return ""

def parse_filename(filename):
    name = filename
    if name.lower().endswith('.pdf'):
        name = name[:-4]
    
    name = re.sub(r'^[\s✨🍎📣🏡🛒🔥🎁🎉]*', '', name)
    name = re.sub(r'[\s✨🍎📣🏡🛒🔥🎁🎉]*$', '', name)
    
    tag = "一般"
    if "KOC" in filename or "KOC" in name:
        tag = "KOC"
    elif "探店" in filename or "探店" in name:
        tag = "探店"
    elif "體驗" in filename or "體驗" in name:
        tag = "體驗"
    elif "展" in filename or "展" in name:
        tag = "展覽"
    elif "合作" in filename or "合作" in name:
        tag = "合作"
    
    bracket_match = re.search(r'【(.*?)】', name)
    if bracket_match:
        content = bracket_match.group(1)
        if "｜" in content:
            title = content.split("｜")[-1].strip()
        else:
            title = content.strip()
            title = re.sub(r'^KOC\s*', '', title).strip()
    else:
        title = name.strip()
        
    return title, tag

def fetch_cloud_jobs(gas_url):
    safe_print("正在從 Google Sheets 獲取雲端最新狀態...")
    try:
        req = urllib.request.Request(gas_url)
        req.add_header("User-Agent", "Mozilla/5.0")
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
            safe_print(f"已成功獲取雲端 {len(data)} 筆案子。")
            return data
    except Exception as e:
        safe_print(f"無法從雲端獲取資料: {e}，將使用本地備份進行合併")
        return None

def upload_to_cloud(gas_url, jobs):
    safe_print("正在將最新進度雙向同步至 Google Sheets...")
    try:
        payload = {
            "action": "overwrite_all",
            "jobs": jobs
        }
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(gas_url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", "Mozilla/5.0")
        
        with urllib.request.urlopen(req, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
            if result.get("success"):
                safe_print("Google Sheets 雲端同步成功！")
                return True
    except Exception as e:
        safe_print(f"上傳雲端失敗: {e}")
    return False

def sync_directory(pdf_dir, db_path):
    gas_url = get_gas_url()
    
    existing_jobs = None
    if gas_url:
        existing_jobs = fetch_cloud_jobs(gas_url)
        
    if existing_jobs is None:
        existing_jobs = []
        if os.path.exists(db_path):
            try:
                with open(db_path, "r", encoding="utf-8") as f:
                    existing_jobs = json.load(f)
            except Exception as e:
                safe_print(f"讀取本地 DB 失敗: {e}")

    job_map = {job["filename"]: job for job in existing_jobs}
    
    current_pdfs = []
    if os.path.exists(pdf_dir):
        for file in os.listdir(pdf_dir):
            if file.lower().endswith(".pdf") and os.path.isfile(os.path.join(pdf_dir, file)):
                current_pdfs.append(file)

    now_str = datetime.now().isoformat()
    
    for pdf in current_pdfs:
        title, tag = parse_filename(pdf)
        pdf_path = os.path.join(pdf_dir, pdf)
        
        if pdf in job_map:
            if job_map[pdf]["status"] == "archived":
                job_map[pdf]["status"] = "pending"
            job_map[pdf]["title"] = title
            job_map[pdf]["tag"] = tag
            
            if not job_map[pdf].get("pdf_url"):
                pdf_url = upload_to_catbox(pdf_path)
                if pdf_url:
                    job_map[pdf]["pdf_url"] = pdf_url
                time.sleep(2)
        else:
            pdf_url = upload_to_catbox(pdf_path)
            time.sleep(2)
            
            job_map[pdf] = {
                "filename": pdf,
                "title": title,
                "tag": tag,
                "status": "pending",
                "note": "",
                "compensation": "",
                "contact": "",
                "platform": "",
                "shoot_date": "",
                "created_at": now_str,
                "pdf_url": pdf_url or ""
            }
            
    for pdf, job in job_map.items():
        if pdf not in current_pdfs and job["status"] != "archived":
            job["status"] = "archived"
            
    updated_jobs = list(job_map.values())
    
    if gas_url:
        upload_to_cloud(gas_url, updated_jobs)
    
    db_dir = os.path.dirname(db_path)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir)
        
    with open(db_path, "w", encoding="utf-8") as f:
        json.dump(updated_jobs, f, ensure_ascii=False, indent=2)
        
    safe_print(f"同步完成！目前 DB 共有 {len(updated_jobs)} 個案子。")

if __name__ == "__main__":
    # 自動取得 jobs-dashboard 資料夾的上一層目錄，即 D:\LifeOS\marketing\job
    current_dir = os.path.dirname(os.path.abspath(__file__))
    marketing_dir = os.path.abspath(os.path.join(current_dir, ".."))
    db_file = os.path.join(current_dir, "jobs_db.json")
    sync_directory(marketing_dir, db_file)
