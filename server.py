import http.server
import socketserver
import json
import os
import urllib.parse
import shutil
import socket
from sync_jobs import sync_directory

PORT = 8000
MARKETING_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.path.join(os.path.dirname(__file__), "jobs_db.json")

def get_local_ip():
    try:
        # 建立一個 UDP socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # 不需要真正連線，僅用於取得本機 IP 分配
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class DashboardHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_GET(self):
        url_parsed = urllib.parse.urlparse(self.path)
        path = url_parsed.path

        if path == "/api/jobs":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if os.path.exists(DB_PATH):
                with open(DB_PATH, "r", encoding="utf-8") as f:
                    self.wfile.write(f.read().encode("utf-8"))
            else:
                self.wfile.write(b"[]")
            return

        elif path.startswith("/pdf/"):
            pdf_filename = urllib.parse.unquote(path[5:])
            pdf_filepath = os.path.join(MARKETING_DIR, pdf_filename)
            
            pdf_filepath = os.path.abspath(pdf_filepath)
            if pdf_filepath.startswith(MARKETING_DIR) and pdf_filepath.lower().endswith(".pdf") and os.path.exists(pdf_filepath):
                self.send_response(200)
                self.send_header("Content-Type", "application/pdf")
                self.send_header("Content-Disposition", f"inline; filename*=UTF-8''{urllib.parse.quote(pdf_filename)}")
                
                stat = os.stat(pdf_filepath)
                self.send_header("Content-Length", str(stat.st_size))
                self.end_headers()
                
                with open(pdf_filepath, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
                return
            else:
                self.send_error(404, "PDF File Not Found")
                return

        super().do_GET()

    def do_POST(self):
        url_parsed = urllib.parse.urlparse(self.path)
        path = url_parsed.path

        if path == "/api/jobs/update":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                update_req = json.loads(post_data.decode('utf-8'))
                filename = update_req.get("filename")
                
                if not filename:
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Missing filename"}).encode("utf-8"))
                    return
                
                if os.path.exists(DB_PATH):
                    with open(DB_PATH, "r", encoding="utf-8") as f:
                        data = json.load(f)
                else:
                    data = []

                updated = False
                for job in data:
                    if job["filename"] == filename:
                        for key in ["status", "note", "compensation", "contact", "platform", "shoot_date"]:
                            if key in update_req:
                                job[key] = update_req[key]
                        updated = True
                        break
                
                if updated:
                    with open(DB_PATH, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                    
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
                else:
                    self.send_response(404)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Job not found"}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        elif path == "/api/sync":
            try:
                sync_directory(MARKETING_DIR, DB_PATH)
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                if os.path.exists(DB_PATH):
                    with open(DB_PATH, "r", encoding="utf-8") as f:
                        self.wfile.write(f.read().encode("utf-8"))
                else:
                    self.wfile.write(b"[]")
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        self.send_error(404, "Not Found")

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    try:
        sync_directory(MARKETING_DIR, DB_PATH)
    except Exception as e:
        print(f"啟動前同步失敗: {e}")

    local_ip = get_local_ip()

    handler = DashboardHTTPRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print("\n" + "="*50)
        print(" Soymilk Job Hub 伺服器已啟動！")
        print(f" 本機開啟網址: http://localhost:{PORT}")
        print(f" 手機連線網址 (同 WiFi): http://{local_ip}:{PORT}")
        print("="*50 + "\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n伺服器正在關閉...")
            httpd.server_close()
