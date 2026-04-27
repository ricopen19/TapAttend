import React, { useState, useEffect, useCallback } from 'react'
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
  const [editingLessonId, setEditingLessonId] = useState<number | null>(null)
  const [isLocked, setIsLocked] = useState(false)
  const [statusTarget, setStatusTarget] = useState<{
    studentId: number
    lessonId: number
    x: number
    y: number
  } | null>(null)

  const recordKey = (lessonId: number, studentId: number) => `${lessonId}-${studentId}`

  const load = useCallback(async () => {
    const [studs, less] = await Promise.all([
      db.students.where('classId').equals(classId).sortBy('number'),
      db.lessons.where('classId').equals(classId).sortBy('sortOrder'),
    ])
    less.sort((a, b) => a.date.localeCompare(b.date))
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

  const setStatus = async (lessonId: number, studentId: number, status: AttendanceStatus) => {
    const key = recordKey(lessonId, studentId)
    const existing = records.get(key)
    if (!existing) return
    await db.attendance.update(existing.id!, { status })
    setRecords(prev => {
      const next = new Map(prev)
      next.set(key, { ...existing, status })
      return next
    })
    setStatusTarget(null)
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

  const getStudentStats = (studentId: number) => {
    let total = 0, present = 0, absent = 0, late = 0, earlyLeave = 0, other = 0
    for (const lesson of lessons) {
      const key = recordKey(lesson.id!, studentId)
      const rec = records.get(key)
      if (!rec) continue
      if (EXCLUDED_FROM_TOTAL.includes(rec.status)) {
        other++
        continue
      }
      total++
      if (rec.status === 'present') present++
      if (rec.status === 'absent') absent++
      if (rec.status === 'late') late++
      if (rec.status === 'earlyLeave') earlyLeave++
    }
    const rate = total > 0 ? Math.round((present / total) * 1000) / 10 : 0
    return { total, present, absent, late, earlyLeave, other, rate }
  }

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const formatWeekday = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    return WEEKDAYS[d.getDay()]
  }

  const updateLessonDate = async (lessonId: number, newDate: string) => {
    if (!newDate) return
    await db.lessons.update(lessonId, { date: newDate })
    setEditingLessonId(null)
    load()
  }

  const exportCsv = () => {
    const BOM = '﻿'
    const header = ['出席番号', '氏名', ...lessons.map(l => formatDate(l.date)), '出席', '欠席', '遅刻', '早退', '公欠等', '出席率']
    const rows = students.map(s => {
      const stats = getStudentStats(s.id!)
      const statuses = lessons.map(l => {
        const rec = records.get(recordKey(l.id!, s.id!))
        return rec ? STATUS_CONFIG[rec.status].symbol : ''
      })
      return [s.number, s.name, ...statuses, stats.present, stats.absent, stats.late, stats.earlyLeave, stats.other, `${stats.rate}%`]
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

  let longPressTimer: ReturnType<typeof setTimeout> | null = null

  const handlePointerDown = (studentId: number, lessonId: number) => {
    if (isLocked) return
    longPressTimer = setTimeout(() => {
      openNote(studentId, lessonId)
      longPressTimer = null
    }, 500)
  }

  const handlePointerUp = (studentId: number, lessonId: number, e: React.PointerEvent<HTMLTableCellElement>) => {
    if (isLocked) return
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setStatusTarget({
        studentId,
        lessonId,
        x: Math.min(rect.left, window.innerWidth - 220),
        y: rect.bottom + 4,
      })
    }
  }

  return (
    <div className="p-2">
      {/* ツールバー */}
      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <button
          onClick={addLesson}
          disabled={isLocked}
          className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ＋ 授業日追加
        </button>
        <button onClick={exportCsv} className="border border-gray-300 dark:border-gray-600 dark:text-gray-300 px-3 py-1.5 rounded text-sm">
          CSV出力
        </button>
        <button
          onClick={() => setIsLocked(!isLocked)}
          className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
            isLocked
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-300 dark:border-amber-600'
              : 'border-gray-300 dark:border-gray-600 dark:text-gray-300'
          }`}
        >
          {isLocked ? '閲覧専用' : '編集可'}
        </button>
      </div>

      {students.length === 0 && (
        <p className="text-gray-400 text-center py-8">
          生徒が登録されていません。戻って生徒を追加してください。
        </p>
      )}

      {students.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
          <table className="text-sm border-collapse w-max min-w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700">
                <th className="sticky left-0 bg-gray-50 dark:bg-gray-700 z-10 border-b border-r border-gray-200 dark:border-gray-600 px-2 py-2 text-left w-10">
                  No
                </th>
                <th className="sticky left-10 bg-gray-50 dark:bg-gray-700 z-10 border-b border-r border-gray-200 dark:border-gray-600 px-2 py-2 text-left min-w-[80px]">
                  氏名
                </th>
                {lessons.map(l => {
                  const weekday = formatWeekday(l.date)
                  const isWeekend = weekday === '土' || weekday === '日'
                  return (
                    <th key={l.id} className="border-b border-r border-gray-200 dark:border-gray-600 px-1 py-1 text-center min-w-[44px]">
                      {editingLessonId === l.id ? (
                        <input
                          type="date"
                          defaultValue={l.date}
                          onBlur={e => updateLessonDate(l.id!, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') updateLessonDate(l.id!, (e.target as HTMLInputElement).value) }}
                          className="text-xs w-28 border border-gray-300 dark:border-gray-600 dark:bg-gray-600 dark:text-gray-100 rounded px-1"
                          autoFocus
                        />
                      ) : (
                        <div
                          className={`text-xs ${isLocked ? '' : 'cursor-pointer'}`}
                          onClick={() => { if (!isLocked) setEditingLessonId(l.id!) }}
                          title={isLocked ? undefined : 'クリックで日付修正'}
                        >
                          <div>{formatDate(l.date)}</div>
                          <div className={isWeekend ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}>
                            {weekday}
                          </div>
                        </div>
                      )}
                      {!isLocked && (
                        <button
                          onClick={() => deleteLesson(l.id!)}
                          className="text-[10px] text-red-400 hover:text-red-600"
                        >
                          ×
                        </button>
                      )}
                    </th>
                  )
                })}
                <th className="border-b border-r border-gray-200 dark:border-gray-600 px-1 py-2 text-center text-xs bg-green-50 dark:bg-green-900/30">出席</th>
                <th className="border-b border-r border-gray-200 dark:border-gray-600 px-1 py-2 text-center text-xs bg-red-50 dark:bg-red-900/30">欠席</th>
                <th className="border-b border-r border-gray-200 dark:border-gray-600 px-1 py-2 text-center text-xs bg-purple-50 dark:bg-purple-900/30">公欠等</th>
                <th className="border-b border-gray-200 dark:border-gray-600 px-1 py-2 text-center text-xs bg-blue-50 dark:bg-blue-900/30">出席率</th>
              </tr>
            </thead>
            <tbody>
              {students.map(s => {
                const stats = getStudentStats(s.id!)
                return (
                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="sticky left-0 bg-white dark:bg-gray-800 z-10 border-b border-r border-gray-200 dark:border-gray-600 px-2 py-1 text-gray-400 text-center">
                      {s.number}
                    </td>
                    <td className="sticky left-10 bg-white dark:bg-gray-800 z-10 border-b border-r border-gray-200 dark:border-gray-600 px-2 py-1 whitespace-nowrap">
                      {s.name || <span className="text-gray-300 dark:text-gray-600 italic">未入力</span>}
                    </td>
                    {lessons.map(l => {
                      const key = recordKey(l.id!, s.id!)
                      const rec = records.get(key)
                      const config = rec ? STATUS_CONFIG[rec.status] : null
                      return (
                        <td
                          key={l.id}
                          className={`border-b border-r border-gray-200 dark:border-gray-600 text-center select-none ${isLocked ? '' : 'cursor-pointer'} ${config?.color || ''} ${rec?.note ? 'ring-1 ring-inset ring-blue-400' : ''}`}
                          style={{ minWidth: 44, minHeight: 36 }}
                          onPointerDown={() => handlePointerDown(s.id!, l.id!)}
                          onPointerUp={e => handlePointerUp(s.id!, l.id!, e)}
                          onPointerCancel={() => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null } }}
                        >
                          <span className="text-base font-medium">{config?.symbol || ''}</span>
                        </td>
                      )
                    })}
                    <td className="border-b border-r border-gray-200 dark:border-gray-600 px-1 py-1 text-center text-xs bg-green-50 dark:bg-green-900/30 font-medium">
                      {stats.present}
                    </td>
                    <td className="border-b border-r border-gray-200 dark:border-gray-600 px-1 py-1 text-center text-xs bg-red-50 dark:bg-red-900/30 font-medium">
                      {stats.absent}
                    </td>
                    <td className="border-b border-r border-gray-200 dark:border-gray-600 px-1 py-1 text-center text-xs bg-purple-50 dark:bg-purple-900/30 font-medium">
                      {stats.other}
                    </td>
                    <td className="border-b border-gray-200 dark:border-gray-600 px-1 py-1 text-center text-xs bg-blue-50 dark:bg-blue-900/30 font-medium">
                      {stats.rate}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ステータス選択ポップアップ */}
      {statusTarget && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setStatusTarget(null)} />
          <div
            className="fixed z-50 bg-white dark:bg-gray-800 shadow-xl rounded-lg border border-gray-200 dark:border-gray-600 p-2"
            style={{ top: statusTarget.y, left: statusTarget.x }}
          >
            <div className="grid grid-cols-4 gap-1">
              {STATUS_CYCLE.map(status => (
                <button
                  key={status}
                  onClick={() => setStatus(statusTarget.lessonId, statusTarget.studentId, status)}
                  className={`flex flex-col items-center px-2 py-1.5 rounded text-xs font-medium hover:opacity-80 ${STATUS_CONFIG[status].color}`}
                >
                  <span className="text-base leading-tight">{STATUS_CONFIG[status].symbol}</span>
                  <span className="leading-tight">{STATUS_CONFIG[status].label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 備考入力モーダル */}
      {noteTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setNoteTarget(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 w-80 shadow-lg" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-2">備考</h3>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded p-2 text-sm h-24"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setNoteTarget(null)} className="text-gray-500 dark:text-gray-400 text-sm px-3 py-1">取消</button>
              <button onClick={saveNote} className="bg-blue-600 text-white text-sm px-3 py-1 rounded">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
