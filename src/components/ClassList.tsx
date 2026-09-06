import { useState, useEffect, type KeyboardEvent } from 'react'
import { api } from '../gas/api'
import type { SchoolClass } from '../types'

interface Props {
  onSelectClass: (id: string, name: string) => void
  onManageStudents: (id: string, name: string) => void
}

const displayName = (c: SchoolClass) => `${c.gradeClass} ${c.subject}`

// IME変換確定のEnterキーを送信と誤判定しないためのガード（isComposing、Safari向けにkeyCode 229も見る）
const isSubmitEnter = (e: KeyboardEvent) =>
  e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229

export function ClassList({ onSelectClass, onManageStudents }: Props) {
  const [classes, setClasses] = useState<SchoolClass[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newGradeClass, setNewGradeClass] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [newTeacher, setNewTeacher] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSubject, setEditSubject] = useState('')
  const [editTeacher, setEditTeacher] = useState('')
  const [busy, setBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const load = async () => {
    setLoadError(null)
    try {
      setClasses(await api.listClasses())
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => { load() }, [])

  const addClass = async () => {
    if (busy) return
    const gradeClass = newGradeClass.trim()
    const subject = newSubject.trim()
    if (!gradeClass || !subject) return
    setBusy(true)
    setAddError(null)
    try {
      await api.createClass(gradeClass, subject, newTeacher.trim())
      setNewGradeClass('')
      setNewSubject('')
      setNewTeacher('')
      await load()
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const updateClass = async (c: SchoolClass) => {
    const subject = editSubject.trim()
    if (!subject) return
    setEditError(null)
    try {
      await api.renameClass(c.id, c.gradeClass, subject, editTeacher.trim())
      setEditingId(null)
      load()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteClass = async (id: string) => {
    if (!confirm('このクラスを削除しますか？関連する出席データもすべて削除されます。')) return
    await api.deleteClass(id)
    load()
  }

  const exportJson = async () => {
    if (!classes) return
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
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={newGradeClass}
          onChange={e => setNewGradeClass(e.target.value)}
          onKeyDown={e => isSubmitEnter(e) && addClass()}
          placeholder="学年組（例：1 - 1、名簿シート名と一致）"
          disabled={busy}
          className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm disabled:opacity-40"
        />
        <input
          type="text"
          value={newSubject}
          onChange={e => setNewSubject(e.target.value)}
          onKeyDown={e => isSubmitEnter(e) && addClass()}
          placeholder="教科名（例：数学I）"
          disabled={busy}
          className="w-28 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-2 text-sm disabled:opacity-40"
        />
        <button
          onClick={addClass}
          disabled={busy}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-40"
        >
          {busy ? '追加中...' : '追加'}
        </button>
      </div>

      <input
        type="text"
        value={newTeacher}
        onChange={e => setNewTeacher(e.target.value)}
        onKeyDown={e => isSubmitEnter(e) && addClass()}
        placeholder="担当教員（任意）"
        disabled={busy}
        className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm mb-2 disabled:opacity-40"
      />

      {addError && (
        <p className="text-red-500 text-xs mb-4">追加に失敗しました: {addError}</p>
      )}

      {loadError && (
        <div className="text-center py-8">
          <p className="text-red-500 mb-2">読み込みに失敗しました: {loadError}</p>
          <button onClick={load} className="text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-300 px-3 py-1.5 rounded">
            再読み込み
          </button>
        </div>
      )}

      {!loadError && classes === null && (
        <p className="text-gray-400 text-center py-8">読み込み中...</p>
      )}

      {!loadError && classes?.length === 0 && (
        <p className="text-gray-400 text-center py-8">
          クラスがありません。上のフォームから追加してください。
        </p>
      )}

      <ul className="space-y-2">
        {classes?.map(c => (
          <li
            key={c.id}
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3"
          >
            {editingId === c.id ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{c.gradeClass}</span>
                  <input
                    type="text"
                    value={editSubject}
                    onChange={e => setEditSubject(e.target.value)}
                    onKeyDown={e => isSubmitEnter(e) && updateClass(c)}
                    className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 text-sm"
                    autoFocus
                  />
                  <button onClick={() => updateClass(c)} className="text-blue-600 dark:text-blue-400 text-sm">保存</button>
                  <button onClick={() => { setEditingId(null); setEditError(null) }} className="text-gray-400 text-sm">取消</button>
                  <input
                    type="text"
                    value={editTeacher}
                    onChange={e => setEditTeacher(e.target.value)}
                    onKeyDown={e => isSubmitEnter(e) && updateClass(c)}
                    placeholder="担当教員（任意）"
                    className="basis-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 text-sm"
                  />
                </div>
                {editError && <p className="text-red-500 text-xs mt-1">保存に失敗しました: {editError}</p>}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onSelectClass(c.id, displayName(c))}
                  className="flex-1 text-left font-medium"
                >
                  {displayName(c)}
                  {c.teacher && (
                    <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">{c.teacher}</span>
                  )}
                </button>
                <button
                  onClick={() => onManageStudents(c.id, displayName(c))}
                  className="text-gray-500 dark:text-gray-400 text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded"
                >
                  生徒
                </button>
                <button
                  onClick={() => { setEditingId(c.id); setEditSubject(c.subject); setEditTeacher(c.teacher); setEditError(null) }}
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
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700 flex gap-2">
        <button onClick={exportJson} disabled={busy || !classes} className="border border-gray-300 dark:border-gray-600 dark:text-gray-300 px-3 py-1.5 rounded text-sm disabled:opacity-40">
          バックアップ（JSON出力）
        </button>
      </div>
    </div>
  )
}
