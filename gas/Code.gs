// TapAttend GAS バックエンド
//
// スプレッドシート構成:
// - 名簿マスタ（学年ごとに別スプレッドシート、IDは「設定」タブで管理）: 学年組と同名タブ。
//   3行目ヘッダー、4行目以降がデータ。A列=出席番号、C列=氏名。読み取り専用。
// - 司令塔スプレッドシート（ATTENDANCE_SPREADSHEET_ID）: 初回アクセス時に「TapAttend出欠データ」の
//   名前で自動作成される索引ファイル。作成後にリネームしてよく、本番では「TapAttend設定シート」に
//   改名済み（コードはIDで開くのでファイル名には依存しない）。ATTENDANCE_FOLDER_NAME のフォルダとは別物。
//   - 「クラス一覧」タブ: 学年組, 教科名, 組スプレッドシートID, タブ名, 表示順, 作成日時, 担当教員
//   - 「設定」タブ: 学年, スプレッドシートID（名簿マスタの参照先。年度更新時はここを書き換える）
// - 組ごとの出欠データ（`${年度}_${学年組}_出欠席データ`、ATTENDANCE_FOLDER_NAME フォルダ配下に自動作成）:
//   その学年組で開講している教科ごとに1タブ。タブ名は 教科名_担当者名（担当者が空なら教科名のみ）。
//   A列=出席番号, B列=氏名, C列=メモ,
//   D列以降=授業日（ヘッダーが日付文字列）。セルの値=出欠記号、セルのノート=その日の備考。
//   番号・氏名はクラス作成時に名簿マスタからコピーされる。以後は自動同期せず、
//   「名簿を再取り込み」操作（syncRoster）を呼んだときだけ名簿マスタを参照する。
//   1つのスプレッドシートが学年組全体×1年分に膨れ上がらないよう、学年組単位でファイルを分けている。
//
// クラスの id はクライアントに対しては `${組スプレッドシートID}:${タブ名}` という不透明な文字列として渡す。
// 学年組のリネームは非対応（別ファイルへの移動が必要になるため）。クラスを削除して作り直してもらう。
//
// 初回セットアップ: 司令塔スプレッドシート（TapAttend設定シート）の「設定」タブに学年とスプレッドシートIDを入力する。

const CLASS_LIST_SHEET = 'クラス一覧'
const SETTINGS_SHEET = '設定'
const ATTENDANCE_FOLDER_NAME = 'TapAttend出欠データ'
const CLASS_ID_SEP = ':'

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
// ponytail: スクリプト全体で単一ロック。学校規模の同時アクセスなら10秒以内に収まる想定。
// 待ち時間が問題になったらクラスID単位のロックに分ける。
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

function gradeOf_(gradeClass) {
  const m = String(gradeClass).match(/^\d+/)
  if (!m) throw new Error('学年組の先頭が数字ではないため学年を判定できません: ' + gradeClass)
  return m[0]
}

// 学年ごとの名簿マスタIDは司令塔スプレッドシート（TapAttend設定シート）の「設定」タブ（学年, スプレッドシートID）で管理する。
// 年度更新時はGASエディタを触らず、このタブのセルを書き換えるだけでよい。
function getSettingsSheet_() {
  const ss = getAttendanceSs_()
  let sheet = ss.getSheetByName(SETTINGS_SHEET)
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET)
    sheet.getRange(1, 1, 1, 2).setValues([['学年', 'スプレッドシートID']])
  }
  return sheet
}

// ponytail: SpreadsheetApp.openById は呼ぶたびにGoogle側と通信が発生し無視できない遅さになるため、
// 1回のリクエスト（1回のスクリプト実行）内では同じスプレッドシートを開き直さず使い回す。
const rosterSsCache_ = {}

function getRosterSs_(gradeClass) {
  const grade = gradeOf_(gradeClass)
  if (rosterSsCache_[grade]) return rosterSsCache_[grade]

  const sheet = getSettingsSheet_()
  const lastRow = sheet.getLastRow()
  const row = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 2).getValues().find(r => String(r[0]).trim() === grade)
    : null
  if (!row || !row[1]) {
    throw new Error(`${grade}学年の名簿マスタのスプレッドシートIDが「設定」タブに登録されていません。`)
  }
  const ss = SpreadsheetApp.openById(String(row[1]).trim())
  rosterSsCache_[grade] = ss
  return ss
}

let attendanceSs_ = null

function getAttendanceSs_() {
  if (attendanceSs_) return attendanceSs_

  const props = PropertiesService.getScriptProperties()
  let id = props.getProperty('ATTENDANCE_SPREADSHEET_ID')
  if (id) {
    attendanceSs_ = SpreadsheetApp.openById(id)
    // 司令塔ファイルをフォルダ配下へ移す機能より前に作られたデプロイの自己修復。
    // フラグで1回だけ実行し、以降はプロパティ読み取り1回で素通りする。
    // 共有は付随機能なので、Drive側の一時失敗で本体の読み書きを止めない（次回再試行）。
    if (!props.getProperty('ATTENDANCE_SS_IN_FOLDER')) {
      try {
        moveIntoAttendanceFolder_(id)
        props.setProperty('ATTENDANCE_SS_IN_FOLDER', '1')
      } catch (e) {
        console.error('司令塔ファイルのフォルダ移動に失敗（次回再試行）: ' + e)
      }
    }
    return attendanceSs_
  }

  // 自動生成時の名前。作成後は ID で開くので、運用側でリネームしてよい（本番は「TapAttend設定シート」）。
  const ss = SpreadsheetApp.create('TapAttend出欠データ')
  props.setProperty('ATTENDANCE_SPREADSHEET_ID', ss.getId())
  moveIntoAttendanceFolder_(ss.getId())
  props.setProperty('ATTENDANCE_SS_IN_FOLDER', '1')
  const sheet = ss.getSheets()[0]
  sheet.setName(CLASS_LIST_SHEET)
  sheet.getRange(1, 1, 1, 7).setValues([['学年組', '教科名', '組スプレッドシートID', 'タブ名', '表示順', '作成日時', '担当教員']])
  attendanceSs_ = ss
  getSettingsSheet_()
  return ss
}

let attendanceFolder_ = null

function getAttendanceFolder_() {
  if (attendanceFolder_) return attendanceFolder_

  const props = PropertiesService.getScriptProperties()
  let id = props.getProperty('ATTENDANCE_FOLDER_ID')
  if (id) {
    attendanceFolder_ = DriveApp.getFolderById(id)
    return attendanceFolder_
  }

  const folder = DriveApp.createFolder(ATTENDANCE_FOLDER_NAME)
  props.setProperty('ATTENDANCE_FOLDER_ID', folder.getId())
  attendanceFolder_ = folder
  return attendanceFolder_
}

// SpreadsheetApp.create はルート直下にファイルを作る。教員への共有はこのフォルダを
// 「閲覧者」で1回共有するだけで済むよう（配下のファイルは共有設定を継承する）、
// 作成したスプレッドシートは必ずフォルダ配下へ移動する。編集はWebアプリ経由のみ。
function moveIntoAttendanceFolder_(fileId) {
  const file = DriveApp.getFileById(fileId)
  getAttendanceFolder_().addFile(file)
  DriveApp.getRootFolder().removeFile(file)
}

// 学校年度（4月始まり）。1〜3月は前年度扱い。
function fiscalYear_() {
  const now = new Date()
  const month = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'M'))
  const year = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy'))
  return month < 4 ? year - 1 : year
}

function sanitizeSheetName_(name) {
  return name.replace(/[[\]*/\\?:]/g, '_').slice(0, 90)
}

function encodeClassId_(groupSsId, tabName) {
  return groupSsId + CLASS_ID_SEP + tabName
}

function decodeClassId_(id) {
  const i = String(id).indexOf(CLASS_ID_SEP)
  if (i === -1) throw new Error('不正なクラスIDです: ' + id)
  return { groupSsId: id.slice(0, i), tabName: id.slice(i + 1) }
}

// ponytail: グループスプレッドシートも同じ理由（openByIdの通信コスト）で1回のリクエスト内は使い回す。
const groupSsCache_ = {}

function openGroupSs_(groupSsId) {
  if (groupSsCache_[groupSsId]) return groupSsCache_[groupSsId]
  const ss = SpreadsheetApp.openById(groupSsId)
  groupSsCache_[groupSsId] = ss
  return ss
}

function findGroupSpreadsheetId_(gradeClass) {
  const listSheet = getAttendanceSs_().getSheetByName(CLASS_LIST_SHEET)
  const lastRow = listSheet.getLastRow()
  if (lastRow < 2) return null
  const values = listSheet.getRange(2, 1, lastRow - 1, 4).getValues()
  const row = values.find(r => r[0] === gradeClass)
  return row ? row[2] : null
}

// 学年組ごとに1ファイル。既にその学年組のクラスがあれば同じファイルを使い回し、
// 無ければ新規作成する（教科タブはcreateClass側で追加する）。
function getOrCreateGroupSpreadsheet_(gradeClass) {
  const existingId = findGroupSpreadsheetId_(gradeClass)
  if (existingId) return { id: existingId, ss: openGroupSs_(existingId), isNew: false }

  const name = `${fiscalYear_()}_${gradeClass}_出欠席データ`
  const ss = SpreadsheetApp.create(name)
  moveIntoAttendanceFolder_(ss.getId())
  groupSsCache_[ss.getId()] = ss
  return { id: ss.getId(), ss, isNew: true }
}

function getRoster(gradeClass) {
  const ss = getRosterSs_(gradeClass)
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
  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues()
  return values
    .filter(row => row[2] && row[3])
    .map(row => ({
      id: encodeClassId_(row[2], row[3]),
      gradeClass: row[0],
      subject: row[1],
      teacher: row[6] || '',
      sortOrder: row[4],
      createdAt: row[5],
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

function createClass(gradeClass, subject, teacher) {
  return withLock_(() => {
    const teacherName = String(teacher || '').trim()

    // 名簿が引けないなら、クラス一覧・クラスシートを作る前に失敗させる（壊れたクラスを残さない）
    const roster = getRoster(gradeClass)

    const classes = listClasses()
    if (classes.some(c => c.gradeClass === gradeClass && c.subject === subject)) {
      throw new Error(`${gradeClass} の ${subject} は既に存在します。`)
    }

    const { ss: groupSs, id: groupSsId, isNew } = getOrCreateGroupSpreadsheet_(gradeClass)
    // タブ名は 教科名_担当者名（担当者が空なら教科名のみ）。id はこのタブ名から生成され rename では変わらない。
    const tabName = sanitizeSheetName_(teacherName ? `${subject}_${teacherName}` : subject)
    if (groupSs.getSheetByName(tabName)) {
      throw new Error(`${gradeClass} に「${tabName}」のタブが既に存在します。`)
    }

    const listSheet = getAttendanceSs_().getSheetByName(CLASS_LIST_SHEET)
    const createdAt = new Date().toISOString()
    const sortOrder = classes.length > 0 ? Math.max(...classes.map(c => c.sortOrder)) + 1 : 0
    listSheet.appendRow([gradeClass, subject, groupSsId, tabName, sortOrder, createdAt, teacherName])

    const classSheet = isNew ? groupSs.getSheets()[0].setName(tabName) : groupSs.insertSheet(tabName)
    classSheet.getRange(1, 1, 1, 3).setValues([['番号', '氏名', 'メモ']])
    if (roster.length > 0) {
      classSheet.getRange(2, 1, roster.length, 3).setValues(roster.map(s => [s.number, s.name, '']))
    }

    return { id: encodeClassId_(groupSsId, tabName), gradeClass, subject, teacher: teacherName, sortOrder, createdAt }
  })
}

// クラス一覧からidに一致する行を探す。見つからなければnull。
function findClassRow_(id) {
  const listSheet = getAttendanceSs_().getSheetByName(CLASS_LIST_SHEET)
  const values = listSheet.getDataRange().getValues()
  for (let i = 1; i < values.length; i++) {
    if (encodeClassId_(values[i][2], values[i][3]) === id) {
      return { listSheet, rowIndex: i + 1, groupSsId: values[i][2], tabName: values[i][3] }
    }
  }
  return null
}

// 学年組の変更は非対応（別ファイルへの移動が必要になるため）。教科名と担当教員を変更できる。
function renameClass(id, gradeClass, subject, teacher) {
  withLock_(() => {
    const current = getClassInfo_(id)
    if (current.gradeClass !== gradeClass) {
      throw new Error('学年組は変更できません。クラスを削除して作り直してください。')
    }
    const row = findClassRow_(id)
    if (!row) throw new Error('クラスが見つかりません: ' + id)
    row.listSheet.getRange(row.rowIndex, 2).setValue(subject)
    row.listSheet.getRange(row.rowIndex, 7).setValue(String(teacher || '').trim())
  })
}

function deleteClass(id) {
  withLock_(() => {
    const row = findClassRow_(id)
    if (!row) return
    row.listSheet.deleteRow(row.rowIndex)

    const groupSs = openGroupSs_(row.groupSsId)
    const sheet = groupSs.getSheetByName(row.tabName)
    if (!sheet) return
    // 学年組の最後のタブならファイルごと不要になる（スプレッドシートはタブ0枚にできない）
    if (groupSs.getSheets().length <= 1) {
      DriveApp.getFileById(row.groupSsId).setTrashed(true)
    } else {
      groupSs.deleteSheet(sheet)
    }
  })
}

function getClassInfo_(id) {
  const classInfo = listClasses().find(c => c.id === id)
  if (!classInfo) throw new Error('クラスが見つかりません: ' + id)
  return classInfo
}

function getClassSheetAndHeader_(id) {
  const { groupSsId, tabName } = decodeClassId_(id)
  const ss = openGroupSs_(groupSsId)
  const sheet = ss.getSheetByName(tabName)
  if (!sheet) throw new Error('クラスが見つかりません: ' + id)
  const lastCol = Math.max(sheet.getLastColumn(), 3)
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
  return { sheet, header, lastCol }
}

// 名簿マスタの生徒（番号・氏名）をクラスシートへ反映する。名簿マスタ側で氏名を修正した場合は
// 既存行を上書きし、新しく追加された生徒は末尾に追記する。呼び出したときだけ名簿マスタを開く。
function syncRoster(id) {
  return withLock_(() => {
    const classInfo = getClassInfo_(id)
    const roster = getRoster(classInfo.gradeClass)
    const { sheet } = getClassSheetAndHeader_(id)
    const lastRow = sheet.getLastRow()
    const rowByNumber = new Map()
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach((row, i) => rowByNumber.set(row[0], i + 2))
    }

    const appended = []
    roster.forEach(s => {
      const rowIdx = rowByNumber.get(s.number)
      if (rowIdx) {
        sheet.getRange(rowIdx, 2).setValue(s.name)
      } else {
        appended.push([s.number, s.name, ''])
      }
    })
    if (appended.length > 0) {
      sheet.getRange(lastRow + 1, 1, appended.length, 3).setValues(appended)
    }

    return getStudents(id)
  })
}

// header[0]='番号', header[1]='氏名', header[2]='メモ', header[3..]=授業日
function dateColumns_(header) {
  return header.slice(3).map((date, i) => ({ date, col: i + 4 }))
}

function getStudents(id) {
  const { sheet } = getClassSheetAndHeader_(id)
  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  return sheet.getRange(2, 1, lastRow - 1, 3).getValues()
    .filter(row => row[0] !== '' && row[0] !== null)
    .map(row => ({ number: row[0], name: row[1], memo: row[2] || '' }))
}

function saveMemo(id, number, memo) {
  withLock_(() => {
    const { sheet } = getClassSheetAndHeader_(id)
    const lastRow = sheet.getLastRow()
    if (lastRow < 2) return
    const numbers = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0])
    const rowIdx = numbers.indexOf(number)
    if (rowIdx === -1) return
    sheet.getRange(rowIdx + 2, 3).setValue(memo)
  })
}

function getAttendanceData(id) {
  const classInfo = getClassInfo_(id)
  const { sheet, header, lastCol } = getClassSheetAndHeader_(id)
  const dates = dateColumns_(header).map(d => d.date)

  const lastRow = sheet.getLastRow()
  const statusRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : []
  const noteRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getNotes() : []

  const students = statusRows.map((row, i) => ({
    number: row[0],
    name: row[1],
    memo: row[2] || '',
    statuses: row.slice(3),
    notes: noteRows[i].slice(3),
  })).filter(s => s.number !== '' && s.number !== null)

  const records = {}
  dates.forEach((date, colIdx) => {
    records[date] = {}
    students.forEach(s => {
      records[date][s.number] = {
        status: symbolToStatus_(s.statuses[colIdx]),
        note: s.notes[colIdx] || '',
      }
    })
  })

  return {
    class: classInfo,
    students: students.map(s => ({ number: s.number, name: s.name, memo: s.memo })),
    dates,
    records,
  }
}

function addLesson(id) {
  return withLock_(() => {
    const { sheet, header, lastCol } = getClassSheetAndHeader_(id)
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')
    if (dateColumns_(header).some(d => d.date === today)) return getAttendanceData(id)
    const newCol = lastCol + 1
    sheet.getRange(1, newCol).setNumberFormat('@').setValue(today)
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
    if (dateColumns_(header).some(d => d.date === newDate)) throw new Error('その日付の授業日は既に存在します: ' + newDate)
    const col = dateColumns_(header).find(d => d.date === oldDate)
    if (col) sheet.getRange(1, col.col).setNumberFormat('@').setValue(newDate)
    return getAttendanceData(id)
  })
}

// edits: [{ number, date, status, note }]
// 戻り値なし: クライアントは楽観的更新済みで、保存後のフル再取得は使っていない。
// 末尾の getAttendanceData（全セル getValues + getNotes）を省くとホットパスの最大コストが消える。
function saveAttendanceEdits(id, edits) {
  withLock_(() => {
    const { sheet, header } = getClassSheetAndHeader_(id)
    const lastRow = sheet.getLastRow()
    if (lastRow < 2) return
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
  })
}
