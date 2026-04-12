import { useState } from 'react'
import { ClassList } from './components/ClassList'
import { AttendanceSheet } from './components/AttendanceSheet'
import { StudentManager } from './components/StudentManager'
import { useDarkMode } from './hooks/useDarkMode'

type Screen =
  | { type: 'home' }
  | { type: 'attendance'; classId: number; className: string }
  | { type: 'students'; classId: number; className: string }

function App() {
  const [screen, setScreen] = useState<Screen>({ type: 'home' })
  const { isDark, toggle: toggleDark } = useDarkMode()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 dark:text-gray-100">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-3">
        {screen.type !== 'home' && (
          <button
            onClick={() => setScreen({ type: 'home' })}
            className="text-blue-600 dark:text-blue-400 text-sm"
          >
            ← 戻る
          </button>
        )}
        <h1 className="text-lg font-bold flex-1">
          {screen.type === 'home' && 'TapAttend'}
          {screen.type === 'attendance' && screen.className}
          {screen.type === 'students' && `${screen.className} - 生徒管理`}
        </h1>
        <button
          onClick={toggleDark}
          className="text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
          title={isDark ? 'ライトモード' : 'ダークモード'}
        >
          {isDark ? '☀' : '🌙'}
        </button>
      </header>

      <main>
        {screen.type === 'home' && (
          <ClassList
            onSelectClass={(id, name) =>
              setScreen({ type: 'attendance', classId: id, className: name })
            }
            onManageStudents={(id, name) =>
              setScreen({ type: 'students', classId: id, className: name })
            }
          />
        )}
        {screen.type === 'attendance' && (
          <AttendanceSheet classId={screen.classId} />
        )}
        {screen.type === 'students' && (
          <StudentManager classId={screen.classId} />
        )}
      </main>
    </div>
  )
}

export default App
