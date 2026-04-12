import { useState, useEffect } from 'react'
import { db } from '../db'
import type { SchoolClass } from '../types'

interface Props {
  onSelectClass: (id: number, name: string) => void
  onManageStudents: (id: number, name: string) => void
}

export function ClassList({ onSelectClass, onManageStudents }: Props) {
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [newName, setNewName] = useState('')
  const [studentCount, setStudentCount] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')

  const load = async () => {
    const all = await db.classes.orderBy('sortOrder').toArray()
    setClasses(all)
  }

  useEffect(() => { load() }, [])

  const addClass = async () => {
    const name = newName.trim()
    if (!name) return
    const count = parseInt(studentCount)

    const classId = await db.classes.add({
      name,
      sortOrder: classes.length,
      createdAt: new Date(),
    }) as number

    // 人数が指定されていれば生徒のガワを自動生成
    if (!isNaN(count) && count > 0) {
      const students = Array.from({ length: count }, (_, i) => ({
        classId,
        number: i + 1,
        name: '',
      }))
      await db.students.bulkAdd(students)
      setNewName('')
      setStudentCount('')
      load()
      // 生徒管理画面へ遷移
      onManageStudents(classId, name)
      return
    }

    setNewName('')
    setStudentCount('')
    load()
  }

  const updateClass = async (id: number) => {
    const name = editName.trim()
    if (!name) return
    await db.classes.update(id, { name })
    setEditingId(null)
    load()
  }

  const deleteClass = async (id: number) => {
    if (!confirm('このクラスを削除しますか？関連する出席データもすべて削除されます。')) return
    const lessonIds = (await db.lessons.where('classId').equals(id).toArray()).map(l => l.id!)
    await db.attendance.where('lessonId').anyOf(lessonIds).delete()
    await db.lessons.where('classId').equals(id).delete()
    await db.students.where('classId').equals(id).delete()
    await db.classes.delete(id)
    load()
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addClass()}
          placeholder="クラス名（例：2年3組 数学I）"
          className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm"
        />
        <input
          type="number"
          value={studentCount}
          onChange={e => setStudentCount(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addClass()}
          placeholder="人数"
          className="w-16 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-2 text-sm"
          min="1"
          max="99"
        />
        <button
          onClick={addClass}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium"
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
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && updateClass(c.id!)}
                  className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 text-sm"
                  autoFocus
                />
                <button onClick={() => updateClass(c.id!)} className="text-blue-600 dark:text-blue-400 text-sm">保存</button>
                <button onClick={() => setEditingId(null)} className="text-gray-400 text-sm">取消</button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onSelectClass(c.id!, c.name)}
                  className="flex-1 text-left font-medium"
                >
                  {c.name}
                </button>
                <button
                  onClick={() => onManageStudents(c.id!, c.name)}
                  className="text-gray-500 dark:text-gray-400 text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded"
                >
                  生徒
                </button>
                <button
                  onClick={() => { setEditingId(c.id!); setEditName(c.name) }}
                  className="text-gray-500 dark:text-gray-400 text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded"
                >
                  編集
                </button>
                <button
                  onClick={() => deleteClass(c.id!)}
                  className="text-red-500 dark:text-red-400 text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded"
                >
                  削除
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
