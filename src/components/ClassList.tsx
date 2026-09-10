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

// ponytail: AttendanceSheet の attendanceCache と同じ SWR 的キャッシュ。トップへ戻るたびの
// 再ロード待ちをなくす。タブを開いている間だけ（リロードで消える）。追加・改名・削除は
// load() 経由でこのキャッシュも更新される。
let classListCache: SchoolClass[] | null = null

export function ClassList({ onSelectClass, onManageStudents }: Props) {
  const [classes, setClasses] = useState<SchoolClass[] | null>(() => classListCache)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newGradeClass, setNewGradeClass] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [newTeacher, setNewTeacher] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSubject, setEditSubject] = useState('')
  const [editTeacher, setEditTeacher] = useState('')
  const [busy, setBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  // 担当フィルタ（T34, docs/spec.md）: 端末ローカルのみ。認証はせず、名前の完全一致で一覧を畳む。
  const [teacherName, setTeacherName] = useState(() => localStorage.getItem('tapattend-teacher') || '')
  const [classFilter, setClassFilter] = useState<'mine' | 'all'>(
    () => (localStorage.getItem('tapattend-class-filter') === 'all' ? 'all' : 'mine'),
  )
  useEffect(() => {
    if (teacherName) localStorage.setItem('tapattend-teacher', teacherName)
    else localStorage.removeItem('tapattend-teacher')
  }, [teacherName])
  useEffect(() => { localStorage.setItem('tapattend-class-filter', classFilter) }, [classFilter])

  const load = async () => {
    setLoadError(null)
    try {
      classListCache = await api.listClasses()
      setClasses(classListCache)
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

  const registered = teacherName.trim() !== ''
  // 候補 = 今あるクラスの teacher ユニーク値 ∪ 登録名。候補ゼロ（クラス未作成）のときだけ自由記入にする。
  const teacherOptions = Array.from(
    new Set(
      [...(classes ?? []).map(c => c.teacher.trim()), teacherName.trim()].filter(Boolean),
    ),
  ).sort()
  const matchesTeacher = (c: SchoolClass) => {
    const t = c.teacher.trim()
    return t === '' || t === teacherName.trim() // teacher 未設定は常に表示（入力漏れで点呼不能を防ぐ）
  }
  const visibleClasses =
    classes == null || !registered || classFilter === 'all' ? classes : classes.filter(matchesTeacher)
  const noMatch =
    registered && classFilter === 'mine' && classes != null && classes.length > 0 && visibleClasses?.length === 0

  return (
    <div className="p-4 max-w-lg mx-auto">
      {/* 担当フィルタ（T34） */}
      <div className="mb-3 text-sm">
        {registered ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-500 dark:text-gray-400">絞り込み:</span>
            <select
              value={teacherName.trim()}
              onChange={e => setTeacherName(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
            >
              {teacherOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={() => setTeacherName('')} className="text-xs text-gray-400">
              登録解除
            </button>
            <div className="ml-auto flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
              {(['mine', 'all'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setClassFilter(f)}
                  aria-pressed={classFilter === f}
                  className={`px-2 py-1 text-xs ${
                    classFilter === f ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {f === 'mine' ? '担当のみ' : 'すべて'}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-500 dark:text-gray-400">
              クラス/教科登録時に担当を追加すると担当者名で絞り込み表示ができます
            </span>
            {teacherOptions.length > 0 ? (
              <select
                value=""
                onChange={e => e.target.value && setTeacherName(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
              >
                <option value="">教員を選択</option>
                {teacherOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : (
              <input
                type="text"
                placeholder="担当教員名"
                onKeyDown={e => { if (isSubmitEnter(e)) setTeacherName(e.currentTarget.value.trim()) }}
                onBlur={e => setTeacherName(e.target.value.trim())}
                className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
              />
            )}
          </div>
        )}
      </div>

      <button
        onClick={() => setShowAddForm(v => !v)}
        className="text-sm text-blue-600 dark:text-blue-400 mb-2"
      >
        {showAddForm ? '× 閉じる' : '＋ クラスを追加'}
      </button>

      {showAddForm && (
        <>
          <input
            type="text"
            value={newGradeClass}
            onChange={e => setNewGradeClass(e.target.value)}
            onKeyDown={e => isSubmitEnter(e) && addClass()}
            placeholder="学年組（例：1 - 1、名簿シート名と一致）"
            disabled={busy}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm mb-2 disabled:opacity-40"
          />
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newSubject}
              onChange={e => setNewSubject(e.target.value)}
              onKeyDown={e => isSubmitEnter(e) && addClass()}
              placeholder="教科名（数学I）"
              disabled={busy}
              className="flex-1 min-w-0 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-2 text-sm disabled:opacity-40"
            />
            <input
              type="text"
              value={newTeacher}
              onChange={e => setNewTeacher(e.target.value)}
              onKeyDown={e => isSubmitEnter(e) && addClass()}
              placeholder="担当（任意）"
              disabled={busy}
              className="flex-1 min-w-0 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-2 text-sm disabled:opacity-40"
            />
            <button
              onClick={addClass}
              disabled={busy}
              className="shrink-0 bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-40"
            >
              {busy ? '追加中...' : '追加'}
            </button>
          </div>
          {addError && (
            <p className="text-red-500 text-xs mb-4">追加に失敗しました: {addError}</p>
          )}
        </>
      )}

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1 mt-3">クラス/教科一覧</p>

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
          クラスがありません。「＋ クラスを追加」から登録してください。
        </p>
      )}

      {noMatch && (
        <p className="text-gray-400 text-center py-8">
          「{teacherName}」さんの担当クラスがありません。
          <button onClick={() => setClassFilter('all')} className="text-blue-600 dark:text-blue-400 ml-1">
            すべて表示
          </button>
        </p>
      )}

      <ul className="space-y-2">
        {visibleClasses?.map(c => (
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
                <div className="mt-2 flex">
                  <button
                    onClick={() => deleteClass(c.id)}
                    className="ml-auto text-red-500 dark:text-red-400 text-xs px-2 py-1 border border-red-300 dark:border-red-800 rounded"
                  >
                    このクラスを削除
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onSelectClass(c.id, displayName(c))}
                  className="flex-1 text-left font-medium"
                >
                  {displayName(c)}
                  {c.teacher ? (
                    <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">{c.teacher}</span>
                  ) : (
                    <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">担当未設定</span>
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
