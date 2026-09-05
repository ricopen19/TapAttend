import React, { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../gas/api'
import type { AttendanceData, AttendanceEdit, AttendanceStatus } from '../types'
import { STATUS_CONFIG, STATUS_CYCLE, EXCLUDED_FROM_TOTAL } from '../types'

interface Props {
  classId: string
  classNameLabel: string
  isDark: boolean
}

const FLUSH_DELAY_MS = 800

export function AttendanceSheet({ classId, classNameLabel, isDark }: Props) {
  const [data, setData] = useState<AttendanceData | null>(null)
  const [noteTarget, setNoteTarget] = useState<{ number: number; date: string } | null>(null)
  const [noteText, setNoteText] = useState('')
  const [editingDate, setEditingDate] = useState<string | null>(null)
  const [isLocked, setIsLocked] = useState(true)
  const [statusTarget, setStatusTarget] = useState<{
    number: number
    date: string
    x: number
    y: number
  } | null>(null)

  // ponytail: タップのたびに同期通信すると点呼が遅くなるため、ローカルへ即時反映しつつ
  // 編集をため込んでデバウンスでまとめて送信する。number+date をキーに最新値だけ残す。
  const pendingEdits = useRef<Map<string, AttendanceEdit>>(new Map())
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setData(await api.getAttendanceData(classId))
  }, [classId])

  useEffect(() => { load() }, [load])

  const flushEdits = useCallback(() => {
    if (pendingEdits.current.size === 0) return
    const edits = Array.from(pendingEdits.current.values())
    pendingEdits.current.clear()
    api.saveAttendanceEdits(classId, edits)
  }, [classId])

  useEffect(() => () => flushEdits(), [flushEdits])

  const queueEdit = (edit: AttendanceEdit) => {
    pendingEdits.current.set(`${edit.number}-${edit.date}`, edit)
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(flushEdits, FLUSH_DELAY_MS)
  }

  const addLesson = async () => {
    setData(await api.addLesson(classId))
  }

  const deleteLesson = async (date: string) => {
    if (!confirm('この授業日を削除しますか？')) return
    flushEdits()
    setData(await api.deleteLesson(classId, date))
  }

  const setStatus = (date: string, number: number, status: AttendanceStatus) => {
    if (!data) return
    const existingNote = data.records[date]?.[number]?.note || ''
    setData(prev => {
      if (!prev) return prev
      const next = { ...prev, records: { ...prev.records } }
      next.records[date] = { ...next.records[date], [number]: { status, note: existingNote } }
      return next
    })
    queueEdit({ number, date, status, note: existingNote })
    setStatusTarget(null)
  }

  const openNote = (number: number, date: string) => {
    setNoteText(data?.records[date]?.[number]?.note || '')
    setNoteTarget({ number, date })
  }

  const saveNote = () => {
    if (!noteTarget || !data) return
    const { number, date } = noteTarget
    const existingStatus = data.records[date]?.[number]?.status || 'present'
    setData(prev => {
      if (!prev) return prev
      const next = { ...prev, records: { ...prev.records } }
      next.records[date] = { ...next.records[date], [number]: { status: existingStatus, note: noteText } }
      return next
    })
    queueEdit({ number, date, status: existingStatus, note: noteText })
    setNoteTarget(null)
  }

  const getStudentStats = (number: number) => {
    if (!data) return { total: 0, present: 0, absent: 0, late: 0, earlyLeave: 0, official: 0, suspensionMourning: 0, rate: 0 }
    let total = 0, present = 0, absent = 0, late = 0, earlyLeave = 0, official = 0, suspensionMourning = 0
    for (const date of data.dates) {
      const rec = data.records[date]?.[number]
      if (!rec) continue
      if (EXCLUDED_FROM_TOTAL.includes(rec.status)) {
        if (rec.status === 'official') official++
        if (rec.status === 'mourning' || rec.status === 'suspension') suspensionMourning++
        continue
      }
      total++
      if (rec.status === 'present') present++
      if (rec.status === 'absent') absent++
      if (rec.status === 'late') late++
      if (rec.status === 'earlyLeave') earlyLeave++
    }
    const rate = total > 0 ? Math.round((present / total) * 1000) / 10 : 0
    return { total, present, absent, late, earlyLeave, official, suspensionMourning, rate }
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

  const updateLessonDate = async (oldDate: string, newDate: string) => {
    if (!newDate) return
    flushEdits()
    setData(await api.updateLessonDate(classId, oldDate, newDate))
    setEditingDate(null)
  }

  const sortedDates = data ? [...data.dates].sort((a, b) => a.localeCompare(b)) : []

  const exportCsv = () => {
    if (!data) return
    const BOM = '﻿'
    const header = ['出席番号', '氏名', ...sortedDates.map(formatDate), '出席', '欠課時数', '遅刻', '早退', '公欠', '出停忌引時数', '出席率']
    const rows = data.students.map(s => {
      const stats = getStudentStats(s.number)
      const statuses = sortedDates.map(date => {
        const rec = data.records[date]?.[s.number]
        return rec ? STATUS_CONFIG[rec.status].symbol : ''
      })
      // 欠課時数 = 実欠席 + (遅刻+早退)を3回で1回換算した分
      const kaKaJisuu = stats.absent + Math.floor((stats.late + stats.earlyLeave) / 3)
      return [s.number, s.name, ...statuses, stats.present, kaKaJisuu, stats.late, stats.earlyLeave, stats.official, stats.suspensionMourning, `${stats.rate}%`]
    })
    const csv = [header, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeClassName = classNameLabel.replace(/[/\\:*?"<>|]/g, '_')
    a.download = `attendance_${safeClassName}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handlePointerDown = (number: number, date: string) => {
    if (isLocked) return
    longPressTimer.current = setTimeout(() => {
      openNote(number, date)
      longPressTimer.current = null
    }, 500)
  }

  const handlePointerUp = (number: number, date: string, e: React.PointerEvent<HTMLTableCellElement>) => {
    if (isLocked) return
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const POPUP_HEIGHT = 110
      const yBelow = rect.bottom + 4
      const y = yBelow + POPUP_HEIGHT > window.innerHeight
        ? Math.max(4, rect.top - POPUP_HEIGHT - 4)
        : yBelow
      setStatusTarget({
        number,
        date,
        x: Math.min(rect.left, window.innerWidth - 220),
        y,
      })
    }
  }

  if (!data) return <div className="p-4 text-gray-400 text-center">読み込み中...</div>

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

      {data.students.length === 0 && (
        <p className="text-gray-400 text-center py-8">
          名簿マスタにこの学年組の生徒が見つかりません。
        </p>
      )}

      {data.students.length > 0 && (
        <div className="overflow-x-auto border border-gray-400 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
          <table className="text-sm border-collapse w-max min-w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700">
                <th className="sticky left-0 bg-gray-50 dark:bg-gray-700 z-10 border-b border-r border-gray-500 dark:border-gray-500 px-2 py-2 text-left w-10">
                  No
                </th>
                <th className="sticky left-10 bg-gray-50 dark:bg-gray-700 z-10 border-b border-r border-gray-500 dark:border-gray-500 px-2 py-2 text-left min-w-[80px]">
                  氏名
                </th>
                {sortedDates.map(date => {
                  const weekday = formatWeekday(date)
                  const isWeekend = weekday === '土' || weekday === '日'
                  return (
                    <th key={date} className="border-b border-r border-gray-400 dark:border-gray-700 px-1 py-1 text-center min-w-[44px]">
                      {editingDate === date ? (
                        <input
                          type="date"
                          defaultValue={date}
                          onBlur={e => updateLessonDate(date, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') updateLessonDate(date, (e.target as HTMLInputElement).value) }}
                          className="text-xs w-28 border border-gray-300 dark:border-gray-600 dark:bg-gray-600 dark:text-gray-100 rounded px-1"
                          autoFocus
                        />
                      ) : (
                        <div
                          className={`text-xs ${isLocked ? '' : 'cursor-pointer'}`}
                          onClick={() => { if (!isLocked) setEditingDate(date) }}
                          title={isLocked ? undefined : 'クリックで日付修正'}
                        >
                          <div>{formatDate(date)}</div>
                          <div className={isWeekend ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}>
                            {weekday}
                          </div>
                        </div>
                      )}
                      {!isLocked && (
                        <button
                          onClick={() => deleteLesson(date)}
                          className="text-[10px] text-red-400 hover:text-red-600"
                        >
                          ×
                        </button>
                      )}
                    </th>
                  )
                })}
                <th className="border-b border-r border-gray-400 dark:border-gray-600 px-1 py-2 text-center text-xs bg-green-50 dark:bg-green-900/30">出席</th>
                <th className="border-b border-r border-gray-400 dark:border-gray-600 px-1 py-2 text-center text-xs bg-red-50 dark:bg-red-900/30">欠席</th>
                <th className="border-b border-r border-gray-400 dark:border-gray-600 px-1 py-2 text-center text-xs bg-purple-50 dark:bg-purple-900/30">公欠</th>
                <th className="border-b border-r border-gray-400 dark:border-gray-600 px-1 py-2 text-center text-xs bg-indigo-50 dark:bg-indigo-900/30">出停忌引時数</th>
                <th className="border-b border-gray-400 dark:border-gray-600 px-1 py-2 text-center text-xs bg-blue-50 dark:bg-blue-900/30">出席率</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map(s => {
                const stats = getStudentStats(s.number)
                const isGroupEnd = s.number % 5 === 0
                // Zone A: No/氏名（sticky列）
                const zoneABorder = 'border-gray-500 dark:border-gray-500'
                const zoneASep: React.CSSProperties = isGroupEnd
                  ? { borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: isDark ? '#6b7280' : '#6b7280' }
                  : {}
                // Zone B: 出席入力列
                const zoneBBorder = 'border-gray-400 dark:border-gray-700'
                const zoneBSep: React.CSSProperties = isGroupEnd
                  ? { borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: isDark ? '#374151' : '#9ca3af' }
                  : {}
                // Zone C: 統計列
                const zoneCSep: React.CSSProperties = isGroupEnd
                  ? { borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: isDark ? '#4b5563' : '#9ca3af' }
                  : {}
                return (
                  <tr key={s.number} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className={`sticky left-0 bg-white dark:bg-gray-800 z-10 border-b border-r ${zoneABorder} px-2 py-1 text-gray-400 text-center`} style={zoneASep}>
                      {s.number}
                    </td>
                    <td className={`sticky left-10 bg-white dark:bg-gray-800 z-10 border-b border-r ${zoneABorder} px-2 py-1 whitespace-nowrap`} style={zoneASep}>
                      {s.name || <span className="text-gray-300 dark:text-gray-600 italic">未入力</span>}
                    </td>
                    {sortedDates.map(date => {
                      const rec = data.records[date]?.[s.number]
                      const config = rec ? STATUS_CONFIG[rec.status] : null
                      return (
                        <td
                          key={date}
                          className={`border-b border-r ${zoneBBorder} text-center select-none ${isLocked ? '' : 'cursor-pointer'} ${config?.color || ''} ${rec?.note ? 'ring-1 ring-inset ring-blue-400' : ''}`}
                          style={{ minWidth: 44, minHeight: 36, ...zoneBSep }}
                          onPointerDown={() => handlePointerDown(s.number, date)}
                          onPointerUp={e => handlePointerUp(s.number, date, e)}
                          onPointerCancel={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
                        >
                          <span className="text-base font-medium">{config?.symbol || ''}</span>
                        </td>
                      )
                    })}
                    <td className="border-b border-r border-gray-400 dark:border-gray-600 px-1 py-1 text-center text-xs bg-green-50 dark:bg-green-900/30 font-medium" style={zoneCSep}>
                      {stats.present}
                    </td>
                    <td className="border-b border-r border-gray-400 dark:border-gray-600 px-1 py-1 text-center text-xs bg-red-50 dark:bg-red-900/30 font-medium" style={zoneCSep}>
                      {stats.absent}
                    </td>
                    <td className="border-b border-r border-gray-400 dark:border-gray-600 px-1 py-1 text-center text-xs bg-purple-50 dark:bg-purple-900/30 font-medium" style={zoneCSep}>
                      {stats.official}
                    </td>
                    <td className="border-b border-r border-gray-400 dark:border-gray-600 px-1 py-1 text-center text-xs bg-indigo-50 dark:bg-indigo-900/30 font-medium" style={zoneCSep}>
                      {stats.suspensionMourning}
                    </td>
                    <td className="border-b border-gray-400 dark:border-gray-600 px-1 py-1 text-center text-xs bg-blue-50 dark:bg-blue-900/30 font-medium" style={zoneCSep}>
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
                  onClick={() => setStatus(statusTarget.date, statusTarget.number, status)}
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
