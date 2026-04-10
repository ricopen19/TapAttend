import { useState, useEffect } from 'react'
import { db } from '../db'
import type { Student } from '../types'

interface Props {
  classId: number
}

export function StudentManager({ classId }: Props) {
  const [students, setStudents] = useState<Student[]>([])
  const [newNumber, setNewNumber] = useState('')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editNumber, setEditNumber] = useState('')
  const [editName, setEditName] = useState('')

  const load = async () => {
    const all = await db.students.where('classId').equals(classId).sortBy('number')
    setStudents(all)
  }

  useEffect(() => { load() }, [classId])

  const addStudent = async () => {
    const name = newName.trim()
    const num = parseInt(newNumber)
    if (!name || isNaN(num)) return
    await db.students.add({ classId, number: num, name })
    setNewName('')
    setNewNumber('')
    load()
  }

  const updateStudent = async (id: number) => {
    const name = editName.trim()
    const num = parseInt(editNumber)
    if (!name || isNaN(num)) return
    await db.students.update(id, { number: num, name })
    setEditingId(null)
    load()
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
          className="w-16 border border-gray-300 rounded px-2 py-2 text-sm"
        />
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addStudent()}
          placeholder="氏名"
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
        />
        <button
          onClick={addStudent}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium"
        >
          追加
        </button>
      </div>

      <button
        onClick={handleCsvImport}
        className="mb-4 text-sm text-blue-600 underline"
      >
        CSV で一括取り込み（番号,氏名）
      </button>

      {students.length === 0 && (
        <p className="text-gray-400 text-center py-8">
          生徒がいません。上のフォームから追加してください。
        </p>
      )}

      <ul className="space-y-1">
        {students.map(s => (
          <li
            key={s.id}
            className="bg-white rounded border border-gray-200 px-3 py-2 flex items-center gap-2 text-sm"
          >
            {editingId === s.id ? (
              <>
                <input
                  type="number"
                  value={editNumber}
                  onChange={e => setEditNumber(e.target.value)}
                  className="w-14 border border-gray-300 rounded px-1 py-1 text-sm"
                />
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && updateStudent(s.id!)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                  autoFocus
                />
                <button onClick={() => updateStudent(s.id!)} className="text-blue-600 text-xs">保存</button>
                <button onClick={() => setEditingId(null)} className="text-gray-400 text-xs">取消</button>
              </>
            ) : (
              <>
                <span className="w-8 text-gray-400">{s.number}</span>
                <span className="flex-1">{s.name}</span>
                <button
                  onClick={() => { setEditingId(s.id!); setEditNumber(String(s.number)); setEditName(s.name) }}
                  className="text-gray-400 text-xs"
                >
                  編集
                </button>
                <button onClick={() => deleteStudent(s.id!)} className="text-red-400 text-xs">削除</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
