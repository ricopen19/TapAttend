import type { AttendanceData, AttendanceEdit, SchoolClass, Student } from '../types'

interface GoogleScriptRunner {
  withSuccessHandler: (fn: (result: unknown) => void) => GoogleScriptRunner
  withFailureHandler: (fn: (error: Error) => void) => GoogleScriptRunner
}

// google.script.run はGASが実行時に注入する動的オブジェクトで、呼び出す関数名ぶんの
// メソッドを静的に型付けできない。ここだけ index シグネチャに逃がす。
type GoogleScriptRunnerCallable = GoogleScriptRunner & Record<string, (...args: unknown[]) => void>

declare global {
  interface Window {
    google?: { script?: { run?: GoogleScriptRunnerCallable } }
  }
}

// ponytail: fetch+doPost方式を試したが、サンドボックスiframe→script.google.comへの
// クロスオリジンリクエストは認証Cookieが送られず401になり、組織アカウント限定のアクセス制御と
// 両立できなかった（アクセスを「全員」に緩めるのは生徒データを扱う上で不可）。
// google.script.run はGoogleが認証込みで面倒を見てくれる分、これが現実的な選択。
// GAS Webアプリはまれに応答が返らず固まることがあるため、タイムアウトだけは設けておく。
const TIMEOUT_MS = 20000

// ponytail: GASの実行環境（HtmlService）外では google.script.run が存在しない。
// `npm run dev` でのローカル動作確認はUIの見た目だけで、データ操作はGASデプロイ後に検証する。
function run<T>(functionName: string, ...args: unknown[]): Promise<T> {
  const runner = window.google?.script?.run
  if (!runner) {
    return Promise.reject(new Error('google.script.run が利用できません。GAS上で開いてください。'))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('サーバーからの応答がありません（タイムアウト）。時間をおいて再試行してください。'))
    }, TIMEOUT_MS)
    const bound = runner
      .withSuccessHandler((result: unknown) => { clearTimeout(timer); resolve(result as T) })
      .withFailureHandler((error: Error) => { clearTimeout(timer); reject(error) }) as GoogleScriptRunnerCallable
    bound[functionName](...args)
  })
}

export const api = {
  listClasses: () => run<SchoolClass[]>('listClasses'),
  createClass: (gradeClass: string, subject: string, teacher: string) =>
    run<SchoolClass>('createClass', gradeClass, subject, teacher),
  renameClass: (id: string, gradeClass: string, subject: string, teacher: string) =>
    run<void>('renameClass', id, gradeClass, subject, teacher),
  deleteClass: (id: string) => run<void>('deleteClass', id),
  getStudents: (id: string) => run<Student[]>('getStudents', id),
  syncRoster: (id: string) => run<Student[]>('syncRoster', id),
  saveMemo: (id: string, number: number, memo: string) => run<void>('saveMemo', id, number, memo),
  getAttendanceData: (id: string) => run<AttendanceData>('getAttendanceData', id),
  addLesson: (id: string) => run<AttendanceData>('addLesson', id),
  deleteLesson: (id: string, date: string) => run<AttendanceData>('deleteLesson', id, date),
  updateLessonDate: (id: string, oldDate: string, newDate: string) =>
    run<AttendanceData>('updateLessonDate', id, oldDate, newDate),
  saveAttendanceEdits: (id: string, edits: AttendanceEdit[]) =>
    run<AttendanceData>('saveAttendanceEdits', id, edits),
}
