import { useState, useEffect } from 'react'
import { api } from '../gas/api'
import type { Student } from '../types'

interface Props {
  classId: string
}

export function StudentManager({ classId }: Props) {
  const [students, setStudents] = useState<Student[]>([])
  const [expandedNumber, setExpandedNumber] = useState<number | null>(null)

  useEffect(() => {
    api.getStudents(classId).then(setStudents)
  }, [classId])

  const updateMemoLocal = (number: number, memo: string) => {
    setStudents(prev => prev.map(s => s.number === number ? { ...s, memo } : s))
  }

  const saveMemo = (number: number, memo: string) => {
    api.saveMemo(classId, number, memo).catch(() => alert('メモの保存に失敗しました。'))
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <p className="text-xs text-gray-400 mb-3">
        番号・氏名は名簿マスタから自動取得（このアプリからは編集できません）。メモのみ編集できます。
      </p>

      {students.length === 0 && (
        <p className="text-gray-400 text-center py-8">
          名簿マスタにこの学年組の生徒が見つかりません。
        </p>
      )}

      <ul className="space-y-1">
        {students.map(s => (
          <li
            key={s.number}
            className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"
          >
            <div className="px-3 py-1.5 flex items-center gap-2 text-sm">
              <span className="w-10 text-center text-gray-400">{s.number}</span>
              <span className="flex-1">{s.name}</span>
              <button
                onClick={() => setExpandedNumber(expandedNumber === s.number ? null : s.number)}
                className={`text-xs px-1.5 py-0.5 rounded ${
                  s.memo
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
                title="メモ"
              >
                {expandedNumber === s.number ? '▲' : '▼'}
              </button>
            </div>
            {expandedNumber === s.number && (
              <div className="px-3 pb-2">
                <textarea
                  value={s.memo}
                  onChange={e => updateMemoLocal(s.number, e.target.value)}
                  onBlur={() => saveMemo(s.number, s.memo)}
                  placeholder="メモ（特徴・出来事など）"
                  rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1.5 text-sm resize-y"
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
