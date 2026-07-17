import unittest
import os
import tempfile
import json
import sys

# 將上一級目錄加入路徑以便 import sync_jobs
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import sync_jobs
# 覆寫 get_gas_url 使單元測試不連線真實的雲端 Sheets API
sync_jobs.get_gas_url = lambda: ""

from sync_jobs import parse_filename, sync_directory

class TestSyncJobs(unittest.TestCase):
    def test_parse_filename(self):
        # 測試檔名解析
        cases = [
            ("✨【KOC 合作招募｜台北 101 觀景台體驗】.pdf", "台北 101 觀景台體驗", "KOC"),
            ("✨【KOC 民宿體驗合作招募】🏡.pdf", "民宿體驗合作招募", "KOC"),
            ("台北家具展 × 台灣藝術博覽會.pdf", "台北家具展 × 台灣藝術博覽會", "展覽"),
            ("超人氣韓國潮牌萬步鞋新竹店探店合作.pdf", "超人氣韓國潮牌萬步鞋新竹店探店合作", "探店"),
            ("🍎i'm meme｜2026.8月-Threads體驗招募.pdf", "i'm meme｜2026.8月-Threads體驗招募", "體驗"),
            ("📣纖時刻報名｜開箱合作IG Reels 互惠報名.pdf", "纖時刻報名｜開箱合作IG Reels 互惠報名", "合作"),
        ]
        for filename, expected_title, expected_tag in cases:
            title, tag = parse_filename(filename)
            self.assertEqual(title, expected_title)
            self.assertEqual(tag, expected_tag)

    def test_sync_directory(self):
        # 建立暫存目錄以進行測試
        with tempfile.TemporaryDirectory() as tmp_dir:
            pdf_dir = os.path.join(tmp_dir, "marketing")
            os.makedirs(pdf_dir)
            db_path = os.path.join(tmp_dir, "jobs_db.json")

            # 1. 建立測試用的 PDF 檔案
            pdf_name1 = "✨【KOC 民宿體驗合作招募】🏡.pdf"
            pdf_name2 = "超人氣韓國潮牌萬步鞋新竹店探店合作.pdf"
            with open(os.path.join(pdf_dir, pdf_name1), "w", encoding="utf-8") as f:
                f.write("mock content")
            with open(os.path.join(pdf_dir, pdf_name2), "w", encoding="utf-8") as f:
                f.write("mock content")

            # 執行第一次同步
            sync_directory(pdf_dir, db_path)

            # 驗證 DB 檔案是否存在與內容
            self.assertTrue(os.path.exists(db_path))
            with open(db_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            self.assertEqual(len(data), 2)
            # 找到 pdf_name1 的項目
            job1 = next(item for item in data if item["filename"] == pdf_name1)
            self.assertEqual(job1["status"], "pending")
            self.assertEqual(job1["tag"], "KOC")
            self.assertEqual(job1["title"], "民宿體驗合作招募")

            # 2. 修改其中一個案子的狀態，並新增一個 PDF，刪除一個 PDF
            # 模擬豆漿更新狀態
            job1["status"] = "confirmed"
            job1["note"] = "已安排 8/10 拍攝"
            with open(db_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            # 新增一個 PDF
            pdf_name3 = "🍎i'm meme｜2026.8月-Threads體驗招募.pdf"
            with open(os.path.join(pdf_dir, pdf_name3), "w", encoding="utf-8") as f:
                f.write("mock content")

            # 刪除第二個 PDF (pdf_name2)
            os.remove(os.path.join(pdf_dir, pdf_name2))

            # 執行第二次同步
            sync_directory(pdf_dir, db_path)

            with open(db_path, "r", encoding="utf-8") as f:
                data2 = json.load(f)

            # 應該有 3 個項目（新增了 pdf_name3，而已刪除 of pdf_name2 應該轉為 archived 狀態）
            self.assertEqual(len(data2), 3)

            # 驗證被修改的項目狀態沒變
            job1_new = next(item for item in data2 if item["filename"] == pdf_name1)
            self.assertEqual(job1_new["status"], "confirmed")
            self.assertEqual(job1_new["note"], "已安排 8/10 拍攝")

            # 驗證新增的項目
            job3_new = next(item for item in data2 if item["filename"] == pdf_name3)
            self.assertEqual(job3_new["status"], "pending")

            # 驗證被刪除的項目已 archived
            job2_new = next(item for item in data2 if item["filename"] == pdf_name2)
            self.assertEqual(job2_new["status"], "archived")

if __name__ == "__main__":
    unittest.main()
