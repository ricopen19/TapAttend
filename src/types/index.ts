export type AttendanceStatus =
  | 'present'    // 出席
  | 'absent'     // 欠席
  | 'late'       // 遅刻
  | 'earlyLeave' // 早退
  | 'official'   // 公欠
  | 'mourning'   // 忌引
  | 'suspension' // 出停

export interface SchoolClass {
  id?: number
  name: string
  sortOrder: number
  createdAt: Date
}

export interface Student {
  id?: number
  classId: number
  number: number // 出席番号
  name: string
  memo?: string
}

export interface Lesson {
  id?: number
  classId: number
  date: string // YYYY-MM-DD
  sortOrder: number
}

export interface AttendanceRecord {
  id?: number
  lessonId: number
  studentId: number
  status: AttendanceStatus
  note: string
}

// ステータスの表示定義
export const STATUS_CONFIG: Record<AttendanceStatus, { label: string; symbol: string; color: string }> = {
  present:    { label: '出席', symbol: '○', color: 'bg-green-100 text-green-800' },
  absent:     { label: '欠席', symbol: '×', color: 'bg-red-100 text-red-800' },
  late:       { label: '遅刻', symbol: '△', color: 'bg-yellow-100 text-yellow-800' },
  earlyLeave: { label: '早退', symbol: '▽', color: 'bg-orange-100 text-orange-800' },
  official:   { label: '公欠', symbol: '公', color: 'bg-blue-100 text-blue-800' },
  mourning:   { label: '忌引', symbol: '忌', color: 'bg-purple-100 text-purple-800' },
  suspension: { label: '出停', symbol: '停', color: 'bg-gray-200 text-gray-800' },
}

// タップでサイクルする順序
export const STATUS_CYCLE: AttendanceStatus[] = [
  'present', 'absent', 'late', 'earlyLeave', 'official', 'mourning', 'suspension',
]

// 出席率計算で分母から除外するステータス
export const EXCLUDED_FROM_TOTAL: AttendanceStatus[] = ['official', 'mourning', 'suspension']
