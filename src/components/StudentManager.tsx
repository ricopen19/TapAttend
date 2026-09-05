import { useState, useEffect } from 'react'
import { api } from '../gas/api'
import type { Student } from '../types'

interface Props {
  classId: string
}

export function StudentManager({ classId }: Props) {
  const [students, setStudents] = useState<Student[] | null>(null)
  const [expandedNumber, setExpandedNumber] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = () => {
    setLoadError(null)
    setStudents(null)
    api.getStudents(classId).then(setStudents).catch(e => setLoadError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(load, [classId])

  const syncRoster = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      setStudents(await api.syncRoster(classId))
    } catch (e) {
      alert('名簿の再取り込みに失敗しました: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSyncing(false)
    }
  }

  const updateMemoLocal = (number: number, memo: string) => {
    setStudents(prev => prev && prev.map(s => s.number === number ? { ...s, memo } : s))
  }

  const saveMemo = (number: number, memo: string) => {
    api.saveMemo(classId, number, memo).catch(() => alert('メモの保存に失敗しました。'))
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <p className="text-xs text-gray-400 mb-3">
        番号・氏名はクラス作成時に名簿マスタからコピーされます（このアプリからは編集できません）。
        名簿マスタ側の変更は自動反映されないため、変更後は下のボタンで再取り込みしてください。メモのみ編集できます。
      </p>

      <button
        onClick={syncRoster}
        disabled={syncing}
        className="text-xs border border-gray-300 dark:border-gray-600 dark:text-gray-300 px-2 py-1 rounded mb-3 disabled:opacity-40"
      >
        {syncing ? '取り込み中...' : '名簿を再取り込み'}
      </button>

      {loadError && (
        <div className="text-center py-8">
          <p className="text-red-500 mb-2">読み込みに失敗しました: {loadError}</p>
          <button onClick={load} className="text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-300 px-3 py-1.5 rounded">
            再読み込み
          </button>
        </div>
      )}

      {!loadError && students === null && (
        <p className="text-gray-400 text-center py-8">読み込み中...</p>
      )}

      {!loadError && students?.length === 0 && (
        <p className="text-gray-400 text-center py-8">
          生徒がいません。「名簿を再取り込み」を押してください。
        </p>
      )}

      <ul className="space-y-1">
        {students?.map(s => (
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
