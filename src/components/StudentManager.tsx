import { useState, useEffect } from 'react'
import { db } from '../db'

interface Props {
  classId: number
}

interface EditableStudent {
  id: number
  number: string
  name: string
  memo: string
}

function toInitials(input: string): string {
  const segments = input.match(/[A-Z][a-z]*/g)
  if (!segments) return input
  return segments.map(seg => seg.length === 1 ? seg + '.' : seg).join('')
}

export function StudentManager({ classId }: Props) {
  const [students, setStudents] = useState<EditableStudent[]>([])
  const [newNumber, setNewNumber] = useState('')
  const [newName, setNewName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [initialMode, setInitialMode] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const load = async () => {
    const all = await db.students.where('classId').equals(classId).sortBy('number')
    setStudents(all.map(s => ({ id: s.id!, number: String(s.number), name: s.name, memo: s.memo ?? '' })))
    setDirty(false)
  }

  useEffect(() => { load() }, [classId])

  const updateField = (id: number, field: 'number' | 'name', value: string) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))
    setDirty(true)
  }

  const saveAll = async () => {
    for (const s of students) {
      const num = parseInt(s.number)
      if (isNaN(num)) continue
      await db.students.update(s.id, { number: num, name: s.name, memo: s.memo })
    }
    setDirty(false)
  }

  const addStudent = async () => {
    const num = parseInt(newNumber)
    if (isNaN(num)) return
    await db.students.add({ classId, number: num, name: newName })
    setNewName('')
    setNewNumber('')
    load()
  }

  const saveMemo = async (id: number, memo: string) => {
    await db.students.update(id, { memo })
  }

  const deleteStudent = async (id: number) => {
    if (!confirm('この生徒を削除しますか？出席データも削除されます。')) return
    await db.attendance.where('studentId').equals(id).delete()
    await db.students.delete(id)
    load()
  }

  const handleCsvImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      const lines = text.split('\n').filter(l => l.trim())
      for (const line of lines) {
        const [numStr, name] = line.split(',').map(s => s.trim())
        const num = parseInt(numStr)
        if (!isNaN(num) && name) {
          await db.students.add({ classId, number: num, name })
        }
      }
      load()
    }
    input.click()
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex gap-2 mb-4">
        <input
          type="number"
          value={newNumber}
          onChange={e => setNewNumber(e.target.value)}
          placeholder="番号"
          className="w-16 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-2 text-sm"
        />
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addStudent()}
          placeholder="氏名"
          className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm"
        />
        <button
          onClick={addStudent}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium"
        >
          追加
        </button>
      </div>

      <div className="flex gap-3 mb-4 items-center flex-wrap">
        <button
          onClick={handleCsvImport}
          className="text-sm text-blue-600 dark:text-blue-400 underline"
        >
          CSV で一括取り込み（番号,氏名）
        </button>
        <button
          onClick={() => setInitialMode(v => !v)}
          className={`flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border transition-colors ${
            initialMode
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600'
          }`}
        >
          <span className={`inline-block w-3 h-3 rounded-full transition-colors ${initialMode ? 'bg-white' : 'bg-gray-400 dark:bg-gray-500'}`} />
          A.B.
        </button>
        {dirty && (
          <button
            onClick={saveAll}
            className="bg-green-600 text-white px-4 py-1.5 rounded text-sm font-medium"
          >
            一括保存
          </button>
        )}
      </div>
      {initialMode && (
        <p className="text-xs text-gray-400 mb-3">
          YT→Y.T. / TYamada→T.Yamada（フォーカスを外すと変換）
        </p>
      )}

      {students.length === 0 && (
        <p className="text-gray-400 text-center py-8">
          生徒がいません。上のフォームから追加してください。
        </p>
      )}

      <ul className="space-y-1">
        {students.map(s => (
          <li
            key={s.id}
            className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"
          >
            <div className="px-3 py-1.5 flex items-center gap-2 text-sm">
              <input
                type="number"
                value={s.number}
                onChange={e => updateField(s.id, 'number', e.target.value)}
                className="w-14 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-1 py-1 text-sm text-center"
              />
              <input
                type="text"
                value={s.name}
                onChange={e => updateField(s.id, 'name', e.target.value)}
                onBlur={() => { if (initialMode && s.name) updateField(s.id, 'name', toInitials(s.name)) }}
                placeholder="氏名を入力"
                className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 text-sm"
              />
              <button
                onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                className={`text-xs px-1.5 py-0.5 rounded ${
                  s.memo
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
                title="メモ"
              >
                {expandedId === s.id ? '▲' : '▼'}
              </button>
              <button onClick={() => deleteStudent(s.id)} className="text-red-400 text-xs">削除</button>
            </div>
            {expandedId === s.id && (
              <div className="px-3 pb-2">
                <textarea
                  value={s.memo}
                  onChange={e => {
                    setStudents(prev => prev.map(st => st.id === s.id ? { ...st, memo: e.target.value } : st))
                  }}
                  onBlur={() => saveMemo(s.id, s.memo)}
                  placeholder="メモ（特徴・出来事など）"
                  rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1.5 text-sm resize-y"
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {dirty && students.length > 0 && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={saveAll}
            className="bg-green-600 text-white px-6 py-2 rounded text-sm font-medium"
          >
            一括保存
          </button>
        </div>
      )}
    </div>
  )
}
