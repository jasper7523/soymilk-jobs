// 貼在 Google 試算表 Apps Script 編輯器中的程式碼

function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  
  // 如果只有標頭或空表，回傳空陣列
  if (data.length <= 1) {
    return ContentService.createTextOutput(JSON.stringify([]))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var headers = data[0];
  var jsonArray = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    jsonArray.push(obj);
  }
  
  // 輸出 JSON，並加上 CORS Header 支援跨域讀取
  return ContentService.createTextOutput(JSON.stringify(jsonArray))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var postData = JSON.parse(e.postData.contents);
  var action = postData.action;
  
  // 0. 讀取全部資料 (解決 iOS Safari / Chrome 的 CORS GET 重定向 ITP 阻擋問題)
  if (action === 'get_all') {
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify([]))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var headers = data[0];
    var jsonArray = [];
    for (var i = 1; i < data.length; i++) {
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = data[i][j];
      }
      jsonArray.push(obj);
    }
    return ContentService.createTextOutput(JSON.stringify(jsonArray))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // 1. 覆寫全部資料 (由筆電 Python 同步時呼叫)
  if (action === 'overwrite_all') {
    var jobs = postData.jobs;
    sheet.clear();
    
    if (jobs.length > 0) {
      var headers = ["filename", "title", "tag", "status", "note", "compensation", "contact", "platform", "shoot_date", "created_at", "pdf_url"];
      sheet.appendRow(headers);
      
      var rows = [];
      for (var i = 0; i < jobs.length; i++) {
        var job = jobs[i];
        var row = [];
        for (var j = 0; j < headers.length; j++) {
          row.push(job[headers[j]] || "");
        }
        rows.push(row);
      }
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    return ContentService.createTextOutput(JSON.stringify({success: true}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // 2. 更新單一案子細節 (由手機前端編輯時呼叫)
  if (action === 'update_one') {
    var updatedJob = postData.job;
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var filenameIdx = headers.indexOf("filename");
    
    var updated = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][filenameIdx] === updatedJob.filename) {
        // 更新該行所有非空的欄位
        for (var key in updatedJob) {
          var colIdx = headers.indexOf(key);
          if (colIdx !== -1) {
            sheet.getRange(i + 1, colIdx + 1).setValue(updatedJob[key]);
          }
        }
        updated = true;
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({success: updated}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({error: "Unknown action"}))
    .setMimeType(ContentService.MimeType.JSON);
}
