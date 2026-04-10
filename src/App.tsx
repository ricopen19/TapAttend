import { useState } from 'react'
import { ClassList } from './components/ClassList'
import { AttendanceSheet } from './components/AttendanceSheet'
import { StudentManager } from './components/StudentManager'

type Screen =
  | { type: 'home' }
  | { type: 'attendance'; classId: number; className: string }
  | { type: 'students'; classId: number; className: string }

function App() {
  const [screen, setScreen] = useState<Screen>({ type: 'home' })

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        {screen.type !== 'home' && (
          <button
            onClick={() => setScreen({ type: 'home' })}
            className="text-blue-600 text-sm"
          >
            ← 戻る
          </button>
        )}
        <h1 className="text-lg font-bold">
          {screen.type === 'home' && 'TapAttend'}
          {screen.type === 'attendance' && screen.className}
          {screen.type === 'students' && `${screen.className} - 生徒管理`}
        </h1>
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
