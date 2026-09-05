import { useState, useEffect } from 'react'
import { api } from '../gas/api'
import type { SchoolClass } from '../types'

interface Props {
  onSelectClass: (id: string, name: string) => void
  onManageStudents: (id: string, name: string) => void
}

const displayName = (c: SchoolClass) => `${c.gradeClass} ${c.subject}`

export function ClassList({ onSelectClass, onManageStudents }: Props) {
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [newGradeClass, setNewGradeClass] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editGradeClass, setEditGradeClass] = useState('')
  const [editSubject, setEditSubject] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setClasses(await api.listClasses())
  }

  useEffect(() => { load() }, [])

  const addClass = async () => {
    const gradeClass = newGradeClass.trim()
    const subject = newSubject.trim()
    if (!gradeClass || !subject) return
    setBusy(true)
    try {
      await api.createClass(gradeClass, subject)
      setNewGradeClass('')
      setNewSubject('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const updateClass = async (id: string) => {
    const gradeClass = editGradeClass.trim()
    const subject = editSubject.trim()
    if (!gradeClass || !subject) return
    await api.renameClass(id, gradeClass, subject)
    setEditingId(null)
    load()
  }

  const deleteClass = async (id: string) => {
    if (!confirm('このクラスを削除しますか？関連する出席データもすべて削除されます。')) return
    await api.deleteClass(id)
    load()
  }

  const exportJson = async () => {
    setBusy(true)
    try {
      const data = {
        classes,
        attendance: await Promise.all(classes.map(c => api.getAttendanceData(c.id))),
        exportedAt: new Date().toISOString(),
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tapattend_backup_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={newGradeClass}
          onChange={e => setNewGradeClass(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addClass()}
          placeholder="学年組（例：1 - 1、名簿シート名と一致）"
          className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm"
        />
        <input
          type="text"
          value={newSubject}
          onChange={e => setNewSubject(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addClass()}
          placeholder="教科名（例：数学I）"
          className="w-28 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-2 text-sm"
        />
        <button
          onClick={addClass}
          disabled={busy}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-40"
        >
          追加
        </button>
      </div>

      {classes.length === 0 && (
        <p className="text-gray-400 text-center py-8">
          クラスがありません。上のフォームから追加してください。
        </p>
      )}

      <ul className="space-y-2">
        {classes.map(c => (
          <li
            key={c.id}
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center gap-2"
          >
            {editingId === c.id ? (
              <>
                <input
                  type="text"
                  value={editGradeClass}
                  onChange={e => setEditGradeClass(e.target.value)}
                  className="w-24 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 text-sm"
                  autoFocus
                />
                <input
                  type="text"
                  value={editSubject}
                  onChange={e => setEditSubject(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && updateClass(c.id)}
                  className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 text-sm"
                />
                <button onClick={() => updateClass(c.id)} className="text-blue-600 dark:text-blue-400 text-sm">保存</button>
                <button onClick={() => setEditingId(null)} className="text-gray-400 text-sm">取消</button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onSelectClass(c.id, displayName(c))}
                  className="flex-1 text-left font-medium"
                >
                  {displayName(c)}
                </button>
                <button
                  onClick={() => onManageStudents(c.id, displayName(c))}
                  className="text-gray-500 dark:text-gray-400 text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded"
                >
                  生徒
                </button>
                <button
                  onClick={() => { setEditingId(c.id); setEditGradeClass(c.gradeClass); setEditSubject(c.subject) }}
                  className="text-gray-500 dark:text-gray-400 text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded"
                >
                  編集
                </button>
                <button
                  onClick={() => deleteClass(c.id)}
                  className="text-red-500 dark:text-red-400 text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded"
                >
                  削除
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700 flex gap-2">
        <button onClick={exportJson} disabled={busy} className="border border-gray-300 dark:border-gray-600 dark:text-gray-300 px-3 py-1.5 rounded text-sm disabled:opacity-40">
          バックアップ（JSON出力）
        </button>
      </div>
    </div>
  )
}
