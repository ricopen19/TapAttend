// TapAttend GAS バックエンド
//
// スプレッドシート構成:
// - 名簿マスタ（ROSTER_SPREADSHEET_ID）: 学年組と同名タブ。3行目ヘッダー、4行目以降が
//   データ。A列=出席番号、C列=氏名。読み取り専用。
// - 出欠データ（ATTENDANCE_SPREADSHEET_ID）: 初回アクセス時に自動作成。
//   - 「クラス一覧」タブ: 学年組, 教科名, シート名(id), 表示順, 作成日時
//   - クラスごとのタブ: A列=出席番号, B列=メモ, C列以降=授業日（ヘッダーが日付文字列）。
//     セルの値=出欠記号、セルのノート=その日の備考。
//
// 初回セットアップ: GASエディタから setRosterSpreadsheetId('名簿マスタのID') を1回実行する。

const CLASS_LIST_SHEET = 'クラス一覧'

const STATUS_TO_SYMBOL = {
  present: '○',
  absent: '／',
  late: '遅',
  earlyLeave: '早',
  official: '公',
  mourning: '忌',
  suspension: '停',
}

const SYMBOL_TO_STATUS = Object.keys(STATUS_TO_SYMBOL).reduce((acc, status) => {
  acc[STATUS_TO_SYMBOL[status]] = status
  return acc
}, {})

function symbolToStatus_(symbol) {
  return SYMBOL_TO_STATUS[symbol] || 'present'
}

// クラス作成/削除や出欠の書き込みが複数教員から同時に来た場合の競合を防ぐ
function withLock_(fn) {
  const lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    return fn()
  } finally {
    lock.releaseLock()
  }
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('TapAttend')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, user-scalable=no')
}

// 初回セットアップ用。GASエディタの実行ボタンから手動で1回だけ呼ぶ。
function setRosterSpreadsheetId(id) {
  PropertiesService.getScriptProperties().setProperty('ROSTER_SPREADSHEET_ID', id)
}

function getRosterSs_() {
  const id = PropertiesService.getScriptProperties().getProperty('ROSTER_SPREADSHEET_ID')
  if (!id) throw new Error('名簿マスタのスプレッドシートIDが未設定です。setRosterSpreadsheetId を実行してください。')
  return SpreadsheetApp.openById(id)
}

function getAttendanceSs_() {
  const props = PropertiesService.getScriptProperties()
  let id = props.getProperty('ATTENDANCE_SPREADSHEET_ID')
  if (id) return SpreadsheetApp.openById(id)

  const ss = SpreadsheetApp.create('TapAttend出欠データ')
  props.setProperty('ATTENDANCE_SPREADSHEET_ID', ss.getId())
  const sheet = ss.getSheets()[0]
  sheet.setName(CLASS_LIST_SHEET)
  sheet.getRange(1, 1, 1, 5).setValues([['学年組', '教科名', 'シート名', '表示順', '作成日時']])
  return ss
}

function sanitizeSheetName_(name) {
  return name.replace(/[[\]*/\\?:]/g, '_').slice(0, 90)
}

function uniqueSheetName_(ss, base) {
  let name = base
  let i = 2
  while (ss.getSheetByName(name)) {
    name = `${base}_${i}`
    i++
  }
  return name
}

function getRoster(gradeClass) {
  const ss = getRosterSs_()
  const sheet = ss.getSheetByName(gradeClass)
  if (!sheet) throw new Error('名簿シートが見つかりません: ' + gradeClass)
  const lastRow = sheet.getLastRow()
  if (lastRow < 4) return []
  const values = sheet.getRange(4, 1, lastRow - 3, 3).getValues()
  return values
    .filter(row => row[0] !== '' && row[0] !== null)
    .map(row => ({ number: row[0], name: row[2] }))
}

function listClasses() {
  const ss = getAttendanceSs_()
  const sheet = ss.getSheetByName(CLASS_LIST_SHEET)
  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues()
  return values
    .filter(row => row[2])
    .map(row => ({
      id: row[2],
      gradeClass: row[0],
      subject: row[1],
      sortOrder: row[3],
      createdAt: row[4],
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

function createClass(gradeClass, subject) {
  return withLock_(() => {
    const ss = getAttendanceSs_()
    const listSheet = ss.getSheetByName(CLASS_LIST_SHEET)
    const classes = listClasses()
    const sheetName = uniqueSheetName_(ss, sanitizeSheetName_(`${gradeClass} ${subject}`))
    const createdAt = new Date().toISOString()
    const sortOrder = classes.length

    listSheet.appendRow([gradeClass, subject, sheetName, sortOrder, createdAt])

    const classSheet = ss.insertSheet(sheetName)
    classSheet.getRange(1, 1, 1, 2).setValues([['番号', 'メモ']])
    const roster = getRoster(gradeClass)
    if (roster.length > 0) {
      classSheet.getRange(2, 1, roster.length, 2).setValues(roster.map(s => [s.number, '']))
    }

    return { id: sheetName, gradeClass, subject, sortOrder, createdAt }
  })
}

function renameClass(id, gradeClass, subject) {
  withLock_(() => {
    const listSheet = getAttendanceSs_().getSheetByName(CLASS_LIST_SHEET)
    const values = listSheet.getDataRange().getValues()
    for (let i = 1; i < values.length; i++) {
      if (values[i][2] === id) {
        listSheet.getRange(i + 1, 1, 1, 2).setValues([[gradeClass, subject]])
        return
      }
    }
    throw new Error('クラスが見つかりません: ' + id)
  })
}

function deleteClass(id) {
  withLock_(() => {
    const ss = getAttendanceSs_()
    const listSheet = ss.getSheetByName(CLASS_LIST_SHEET)
    const values = listSheet.getDataRange().getValues()
    for (let i = 1; i < values.length; i++) {
      if (values[i][2] === id) {
        listSheet.deleteRow(i + 1)
        break
      }
    }
    const sheet = ss.getSheetByName(id)
    if (sheet) ss.deleteSheet(sheet)
  })
}

function getClassInfo_(id) {
  const classInfo = listClasses().find(c => c.id === id)
  if (!classInfo) throw new Error('クラスが見つかりません: ' + id)
  return classInfo
}

function getClassSheetAndHeader_(id) {
  const ss = getAttendanceSs_()
  const sheet = ss.getSheetByName(id)
  if (!sheet) throw new Error('クラスが見つかりません: ' + id)
  const lastCol = Math.max(sheet.getLastColumn(), 2)
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
  return { sheet, header, lastCol }
}

// header[0]='番号', header[1]='メモ', header[2..]=授業日
function dateColumns_(header) {
  return header.slice(2).map((date, i) => ({ date, col: i + 3 }))
}

function getStudents(id) {
  const classInfo = getClassInfo_(id)
  const roster = getRoster(classInfo.gradeClass)
  const { sheet, lastCol } = getClassSheetAndHeader_(id)
  const lastRow = sheet.getLastRow()
  const memoByNumber = new Map()
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 2).getValues().forEach(row => {
      memoByNumber.set(row[0], row[1] || '')
    })
  }
  return roster.map(s => ({ number: s.number, name: s.name, memo: memoByNumber.get(s.number) || '' }))
}

function saveMemo(id, number, memo) {
  withLock_(() => {
    const { sheet } = getClassSheetAndHeader_(id)
    const lastRow = sheet.getLastRow()
    if (lastRow < 2) return
    const numbers = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0])
    const rowIdx = numbers.indexOf(number)
    if (rowIdx === -1) return
    sheet.getRange(rowIdx + 2, 2).setValue(memo)
  })
}

function getAttendanceData(id) {
  const classInfo = getClassInfo_(id)
  const roster = getRoster(classInfo.gradeClass)
  const { sheet, header, lastCol } = getClassSheetAndHeader_(id)
  const dates = dateColumns_(header).map(d => d.date)

  const lastRow = sheet.getLastRow()
  const statusRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : []
  const noteRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getNotes() : []
  const byNumber = new Map()
  statusRows.forEach((row, i) => {
    byNumber.set(row[0], { memo: row[1] || '', statuses: row.slice(2), notes: noteRows[i].slice(2) })
  })

  const students = roster.map(s => ({ number: s.number, name: s.name, memo: (byNumber.get(s.number) || {}).memo || '' }))

  const records = {}
  dates.forEach((date, colIdx) => {
    records[date] = {}
    students.forEach(s => {
      const rec = byNumber.get(s.number)
      const symbol = rec ? rec.statuses[colIdx] : ''
      records[date][s.number] = {
        status: symbolToStatus_(symbol),
        note: rec ? (rec.notes[colIdx] || '') : '',
      }
    })
  })

  return { class: classInfo, students, dates, records }
}

function addLesson(id) {
  return withLock_(() => {
    const { sheet, lastCol } = getClassSheetAndHeader_(id)
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')
    const newCol = lastCol + 1
    sheet.getRange(1, newCol).setValue(today)
    const lastRow = sheet.getLastRow()
    if (lastRow > 1) {
      sheet.getRange(2, newCol, lastRow - 1, 1).setValue(STATUS_TO_SYMBOL.present)
    }
    return getAttendanceData(id)
  })
}

function deleteLesson(id, date) {
  return withLock_(() => {
    const { sheet, header } = getClassSheetAndHeader_(id)
    const col = dateColumns_(header).find(d => d.date === date)
    if (col) sheet.deleteColumn(col.col)
    return getAttendanceData(id)
  })
}

function updateLessonDate(id, oldDate, newDate) {
  return withLock_(() => {
    const { sheet, header } = getClassSheetAndHeader_(id)
    const col = dateColumns_(header).find(d => d.date === oldDate)
    if (col) sheet.getRange(1, col.col).setValue(newDate)
    return getAttendanceData(id)
  })
}

// edits: [{ number, date, status, note }]
function saveAttendanceEdits(id, edits) {
  return withLock_(() => {
    const { sheet, header } = getClassSheetAndHeader_(id)
    const lastRow = sheet.getLastRow()
    if (lastRow < 2) return getAttendanceData(id)
    const numbers = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0])
    const dateCols = dateColumns_(header)

    edits.forEach(edit => {
      const rowIdx = numbers.indexOf(edit.number)
      const colInfo = dateCols.find(d => d.date === edit.date)
      if (rowIdx === -1 || !colInfo) return
      const range = sheet.getRange(rowIdx + 2, colInfo.col)
      range.setValue(STATUS_TO_SYMBOL[edit.status] || '')
      range.setNote(edit.note || '')
    })

    return getAttendanceData(id)
  })
}
