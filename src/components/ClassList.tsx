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

  const exportJson = () => {
    db.transaction('r', db.classes, db.students, db.lessons, db.attendance, async () => {
      const data = {
        classes: await db.classes.toArray(),
        students: await db.students.toArray(),
        lessons: await db.lessons.toArray(),
        attendance: await db.attendance.toArray(),
        exportedAt: new Date().toISOString(),
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tapattend_backup_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  const importJson = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      if (!confirm('現在のデータをすべて上書きしますか？')) return
      const text = await file.text()
      const data = JSON.parse(text)
      await db.transaction('rw', db.classes, db.students, db.lessons, db.attendance, async () => {
        await db.classes.clear()
        await db.students.clear()
        await db.lessons.clear()
        await db.attendance.clear()
        if (data.classes) await db.classes.bulkAdd(data.classes)
        if (data.students) await db.students.bulkAdd(data.students)
        if (data.lessons) await db.lessons.bulkAdd(data.lessons)
        if (data.attendance) await db.attendance.bulkAdd(data.attendance)
      })
      load()
    }
    input.click()
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

      <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700 flex gap-2">
        <button onClick={exportJson} className="border border-gray-300 dark:border-gray-600 dark:text-gray-300 px-3 py-1.5 rounded text-sm">
          バックアップ
        </button>
        <button onClick={importJson} className="border border-gray-300 dark:border-gray-600 dark:text-gray-300 px-3 py-1.5 rounded text-sm">
          リストア
        </button>
      </div>
    </div>
  )
}
