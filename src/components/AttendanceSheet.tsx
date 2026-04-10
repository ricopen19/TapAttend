import { useState, useEffect, useCallback } from 'react'
import { db } from '../db'
import type { Student, Lesson, AttendanceRecord, AttendanceStatus } from '../types'
import { STATUS_CONFIG, STATUS_CYCLE, EXCLUDED_FROM_TOTAL } from '../types'

interface Props {
  classId: number
}

export function AttendanceSheet({ classId }: Props) {
  const [students, setStudents] = useState<Student[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [records, setRecords] = useState<Map<string, AttendanceRecord>>(new Map())
  const [noteTarget, setNoteTarget] = useState<{ studentId: number; lessonId: number } | null>(null)
  const [noteText, setNoteText] = useState('')

  const recordKey = (lessonId: number, studentId: number) => `${lessonId}-${studentId}`

  const load = useCallback(async () => {
    const [studs, less] = await Promise.all([
      db.students.where('classId').equals(classId).sortBy('number'),
      db.lessons.where('classId').equals(classId).sortBy('sortOrder'),
    ])
    setStudents(studs)
    setLessons(less)

    if (less.length > 0) {
      const lessonIds = less.map(l => l.id!)
      const allRecords = await db.attendance.where('lessonId').anyOf(lessonIds).toArray()
      const map = new Map<string, AttendanceRecord>()
      for (const r of allRecords) {
        map.set(recordKey(r.lessonId, r.studentId), r)
      }
      setRecords(map)
    }
  }, [classId])

  useEffect(() => { load() }, [load])

  const addLesson = async () => {
    const today = new Date().toISOString().slice(0, 10)
    const lessonId = await db.lessons.add({
      classId,
      date: today,
      sortOrder: lessons.length,
    })

    // 全生徒を「出席」で初期化
    const newRecords: Omit<AttendanceRecord, 'id'>[] = students.map(s => ({
      lessonId: lessonId as number,
      studentId: s.id!,
      status: 'present' as AttendanceStatus,
      note: '',
    }))
    await db.attendance.bulkAdd(newRecords as AttendanceRecord[])
    load()
  }

  const deleteLesson = async (lessonId: number) => {
    if (!confirm('この授業日を削除しますか？')) return
    await db.attendance.where('lessonId').equals(lessonId).delete()
    await db.lessons.delete(lessonId)
    load()
  }

  const cycleStatus = async (lessonId: number, studentId: number) => {
    const key = recordKey(lessonId, studentId)
    const existing = records.get(key)
    if (!existing) return

    const currentIndex = STATUS_CYCLE.indexOf(existing.status)
    const nextStatus = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length]
    await db.attendance.update(existing.id!, { status: nextStatus })

    setRecords(prev => {
      const next = new Map(prev)
      next.set(key, { ...existing, status: nextStatus })
      return next
    })
  }

  const openNote = (studentId: number, lessonId: number) => {
    const key = recordKey(lessonId, studentId)
    const existing = records.get(key)
    setNoteText(existing?.note || '')
    setNoteTarget({ studentId, lessonId })
  }

  const saveNote = async () => {
    if (!noteTarget) return
    const key = recordKey(noteTarget.lessonId, noteTarget.studentId)
    const existing = records.get(key)
    if (existing) {
      await db.attendance.update(existing.id!, { note: noteText })
      setRecords(prev => {
        const next = new Map(prev)
        next.set(key, { ...existing, note: noteText })
        return next
      })
    }
    setNoteTarget(null)
  }

  // 集計
  const getStudentStats = (studentId: number) => {
    let total = 0
    let present = 0
    let absent = 0
    let late = 0
    let earlyLeave = 0

    for (const lesson of lessons) {
      const key = recordKey(lesson.id!, studentId)
      const rec = records.get(key)
      if (!rec) continue
      if (EXCLUDED_FROM_TOTAL.includes(rec.status)) continue
      total++
      if (rec.status === 'present') present++
      if (rec.status === 'absent') absent++
      if (rec.status === 'late') late++
      if (rec.status === 'earlyLeave') earlyLeave++
    }

    const rate = total > 0 ? Math.round((present / total) * 1000) / 10 : 0
    return { total, present, absent, late, earlyLeave, rate }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const exportCsv = () => {
    const BOM = '\uFEFF'
    const header = ['出席番号', '氏名', ...lessons.map(l => formatDate(l.date)), '出席', '欠席', '遅刻', '早退', '出席率']
    const rows = students.map(s => {
      const stats = getStudentStats(s.id!)
      const statuses = lessons.map(l => {
        const rec = records.get(recordKey(l.id!, s.id!))
        return rec ? STATUS_CONFIG[rec.status].symbol : ''
      })
      return [s.number, s.name, ...statuses, stats.present, stats.absent, stats.late, stats.earlyLeave, `${stats.rate}%`]
    })
    const csv = [header, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportJson = () => {
    db.transaction('r', db.classes, db.students, db.lessons, db.attendance, async () => {
      const data = {
        classes: await db.classes.toArray(),
        students: await db.students.toArray(),
        lessons: await db.lessons.toArray(),
        attendance: await db.attendance.toArray(),
        exportedAt: new Date().toISOString(),
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tapattend_backup_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  const importJson = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      if (!confirm('現在のデータをすべて上書きしますか？')) return
      const text = await file.text()
      const data = JSON.parse(text)
      await db.transaction('rw', db.classes, db.students, db.lessons, db.attendance, async () => {
        await db.classes.clear()
        await db.students.clear()
        await db.lessons.clear()
        await db.attendance.clear()
        if (data.classes) await db.classes.bulkAdd(data.classes)
        if (data.students) await db.students.bulkAdd(data.students)
        if (data.lessons) await db.lessons.bulkAdd(data.lessons)
        if (data.attendance) await db.attendance.bulkAdd(data.attendance)
      })
      load()
    }
    input.click()
  }

  let longPressTimer: ReturnType<typeof setTimeout> | null = null

  const handlePointerDown = (studentId: number, lessonId: number) => {
    longPressTimer = setTimeout(() => {
      openNote(studentId, lessonId)
      longPressTimer = null
    }, 500)
  }

  const handlePointerUp = (studentId: number, lessonId: number) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
      cycleStatus(lessonId, studentId)
    }
  }

  return (
    <div className="p-2">
      {/* ツールバー */}
      <div className="flex gap-2 mb-2 flex-wrap">
        <button onClick={addLesson} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium">
          ＋ 授業日追加
        </button>
        <button onClick={exportCsv} className="border border-gray-300 px-3 py-1.5 rounded text-sm">
          CSV出力
        </button>
        <button onClick={exportJson} className="border border-gray-300 px-3 py-1.5 rounded text-sm">
          バックアップ
        </button>
        <button onClick={importJson} className="border border-gray-300 px-3 py-1.5 rounded text-sm">
          リストア
        </button>
      </div>

      {students.length === 0 && (
        <p className="text-gray-400 text-center py-8">
          生徒が登録されていません。戻って生徒を追加してください。
        </p>
      )}

      {students.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
          <table className="text-sm border-collapse w-max min-w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="sticky left-0 bg-gray-50 z-10 border-b border-r border-gray-200 px-2 py-2 text-left w-10">
                  No
                </th>
                <th className="sticky left-10 bg-gray-50 z-10 border-b border-r border-gray-200 px-2 py-2 text-left min-w-[80px]">
                  氏名
                </th>
                {lessons.map(l => (
                  <th key={l.id} className="border-b border-r border-gray-200 px-1 py-2 text-center min-w-[44px]">
                    <div className="text-xs">{formatDate(l.date)}</div>
                    <button
                      onClick={() => deleteLesson(l.id!)}
                      className="text-[10px] text-red-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  </th>
                ))}
                <th className="border-b border-r border-gray-200 px-1 py-2 text-center text-xs bg-green-50">出席</th>
                <th className="border-b border-r border-gray-200 px-1 py-2 text-center text-xs bg-red-50">欠席</th>
                <th className="border-b border-gray-200 px-1 py-2 text-center text-xs bg-blue-50">出席率</th>
              </tr>
            </thead>
            <tbody>
              {students.map(s => {
                const stats = getStudentStats(s.id!)
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="sticky left-0 bg-white z-10 border-b border-r border-gray-200 px-2 py-1 text-gray-400 text-center">
                      {s.number}
                    </td>
                    <td className="sticky left-10 bg-white z-10 border-b border-r border-gray-200 px-2 py-1 whitespace-nowrap">
                      {s.name}
                    </td>
                    {lessons.map(l => {
                      const key = recordKey(l.id!, s.id!)
                      const rec = records.get(key)
                      const config = rec ? STATUS_CONFIG[rec.status] : null
                      return (
                        <td
                          key={l.id}
                          className={`border-b border-r border-gray-200 text-center cursor-pointer select-none ${config?.color || ''} ${rec?.note ? 'ring-1 ring-inset ring-blue-400' : ''}`}
                          style={{ minWidth: 44, minHeight: 36 }}
                          onPointerDown={() => handlePointerDown(s.id!, l.id!)}
                          onPointerUp={() => handlePointerUp(s.id!, l.id!)}
                          onPointerCancel={() => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null } }}
                        >
                          <span className="text-base font-medium">{config?.symbol || ''}</span>
                        </td>
                      )
                    })}
                    <td className="border-b border-r border-gray-200 px-1 py-1 text-center text-xs bg-green-50 font-medium">
                      {stats.present}
                    </td>
                    <td className="border-b border-r border-gray-200 px-1 py-1 text-center text-xs bg-red-50 font-medium">
                      {stats.absent}
                    </td>
                    <td className="border-b border-gray-200 px-1 py-1 text-center text-xs bg-blue-50 font-medium">
                      {stats.rate}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 備考入力モーダル */}
      {noteTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setNoteTarget(null)}>
          <div className="bg-white rounded-lg p-4 w-80 shadow-lg" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-2">備考</h3>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              className="w-full border border-gray-300 rounded p-2 text-sm h-24"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setNoteTarget(null)} className="text-gray-500 text-sm px-3 py-1">取消</button>
              <button onClick={saveNote} className="bg-blue-600 text-white text-sm px-3 py-1 rounded">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
