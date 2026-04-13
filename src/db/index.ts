import Dexie, { type EntityTable } from 'dexie'
import type { SchoolClass, Student, Lesson, AttendanceRecord } from '../types'

const db = new Dexie('TapAttendDB') as Dexie & {
  classes: EntityTable<SchoolClass, 'id'>
  students: EntityTable<Student, 'id'>
  lessons: EntityTable<Lesson, 'id'>
  attendance: EntityTable<AttendanceRecord, 'id'>
}

db.version(1).stores({
  classes: '++id, sortOrder',
  students: '++id, classId, number',
  lessons: '++id, classId, date, sortOrder',
  attendance: '++id, lessonId, studentId, [lessonId+studentId]',
})

db.version(2).stores({
  classes: '++id, sortOrder',
  students: '++id, classId, number',
  lessons: '++id, classId, date, sortOrder',
  attendance: '++id, lessonId, studentId, [lessonId+studentId]',
})

export { db }
