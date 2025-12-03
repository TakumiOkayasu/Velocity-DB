import { create } from 'zustand'

export interface CellChange {
  rowIndex: number
  columnName: string
  originalValue: string | null
  newValue: string | null
}

export interface RowChange {
  type: 'update' | 'insert' | 'delete'
  rowIndex: number
  originalData: Record<string, string | null>
  changes: Record<string, CellChange>
}

interface EditState {
  // Current table context for editing
  tableName: string | null
  schemaName: string | null
  primaryKeyColumns: string[]

  // Pending changes
  pendingChanges: Map<number, RowChange>
  deletedRows: Map<number, Record<string, string | null>>
  insertedRows: Map<number, Record<string, string | null>>

  // Edit mode
  isEditMode: boolean

  // Actions
  setTableContext: (tableName: string, schemaName: string, primaryKeyColumns: string[]) => void
  clearTableContext: () => void

  updateCell: (rowIndex: number, columnName: string, originalValue: string | null, newValue: string | null, rowData?: Record<string, string | null>) => void
  revertCell: (rowIndex: number, columnName: string) => void
  revertRow: (rowIndex: number) => void
  revertAll: () => void

  markRowDeleted: (rowIndex: number, rowData: Record<string, string | null>) => void
  unmarkRowDeleted: (rowIndex: number) => void

  addNewRow: (rowData: Record<string, string | null>) => number
  removeInsertedRow: (rowIndex: number) => void

  setEditMode: (enabled: boolean) => void

  // Helpers
  hasChanges: () => boolean
  getChangedRows: () => RowChange[]
  getCellChange: (rowIndex: number, columnName: string) => CellChange | null
  isRowDeleted: (rowIndex: number) => boolean
  isRowInserted: (rowIndex: number) => boolean

  // Generate SQL
  generateUpdateSQL: () => string[]
  generateInsertSQL: () => string[]
  generateDeleteSQL: () => string[]
}

let insertRowCounter = -1

export const useEditStore = create<EditState>((set, get) => ({
  tableName: null,
  schemaName: null,
  primaryKeyColumns: [],
  pendingChanges: new Map(),
  deletedRows: new Map(),
  insertedRows: new Map(),
  isEditMode: false,

  setTableContext: (tableName, schemaName, primaryKeyColumns) => {
    set({
      tableName,
      schemaName,
      primaryKeyColumns,
      pendingChanges: new Map(),
      deletedRows: new Map(),
      insertedRows: new Map(),
    })
  },

  clearTableContext: () => {
    set({
      tableName: null,
      schemaName: null,
      primaryKeyColumns: [],
      pendingChanges: new Map(),
      deletedRows: new Map(),
      insertedRows: new Map(),
    })
  },

  updateCell: (rowIndex, columnName, originalValue, newValue, rowData = {}) => {
    const { pendingChanges, insertedRows } = get()

    // Handle inserted rows separately
    if (insertedRows.has(rowIndex)) {
      const row = insertedRows.get(rowIndex)!
      row[columnName] = newValue
      set({ insertedRows: new Map(insertedRows) })
      return
    }

    const newChanges = new Map(pendingChanges)
    let rowChange = newChanges.get(rowIndex)

    if (!rowChange) {
      rowChange = {
        type: 'update',
        rowIndex,
        originalData: { ...rowData },
        changes: {},
      }
    }

    // If reverting to original value, remove the change
    if (originalValue === newValue) {
      delete rowChange.changes[columnName]
      if (Object.keys(rowChange.changes).length === 0) {
        newChanges.delete(rowIndex)
      } else {
        newChanges.set(rowIndex, { ...rowChange })
      }
    } else {
      rowChange.changes[columnName] = {
        rowIndex,
        columnName,
        originalValue,
        newValue,
      }
      newChanges.set(rowIndex, { ...rowChange })
    }

    set({ pendingChanges: newChanges })
  },

  revertCell: (rowIndex, columnName) => {
    const { pendingChanges } = get()
    const newChanges = new Map(pendingChanges)
    const rowChange = newChanges.get(rowIndex)

    if (rowChange) {
      delete rowChange.changes[columnName]
      if (Object.keys(rowChange.changes).length === 0) {
        newChanges.delete(rowIndex)
      } else {
        newChanges.set(rowIndex, { ...rowChange })
      }
      set({ pendingChanges: newChanges })
    }
  },

  revertRow: (rowIndex) => {
    const { pendingChanges, deletedRows, insertedRows } = get()
    const newChanges = new Map(pendingChanges)
    const newDeleted = new Map(deletedRows)
    const newInserted = new Map(insertedRows)

    newChanges.delete(rowIndex)
    newDeleted.delete(rowIndex)
    newInserted.delete(rowIndex)

    set({
      pendingChanges: newChanges,
      deletedRows: newDeleted,
      insertedRows: newInserted,
    })
  },

  revertAll: () => {
    set({
      pendingChanges: new Map(),
      deletedRows: new Map(),
      insertedRows: new Map(),
    })
  },

  markRowDeleted: (rowIndex, rowData) => {
    const { deletedRows, pendingChanges } = get()
    const newDeleted = new Map(deletedRows)
    const newChanges = new Map(pendingChanges)

    newDeleted.set(rowIndex, { ...rowData })
    newChanges.delete(rowIndex) // Remove any pending edits for deleted row

    set({ deletedRows: newDeleted, pendingChanges: newChanges })
  },

  unmarkRowDeleted: (rowIndex) => {
    const { deletedRows } = get()
    const newDeleted = new Map(deletedRows)
    newDeleted.delete(rowIndex)
    set({ deletedRows: newDeleted })
  },

  addNewRow: (rowData) => {
    const { insertedRows } = get()
    const newInserted = new Map(insertedRows)
    const newRowIndex = insertRowCounter--
    newInserted.set(newRowIndex, rowData)
    set({ insertedRows: newInserted })
    return newRowIndex
  },

  removeInsertedRow: (rowIndex) => {
    const { insertedRows } = get()
    const newInserted = new Map(insertedRows)
    newInserted.delete(rowIndex)
    set({ insertedRows: newInserted })
  },

  setEditMode: (enabled) => {
    set({ isEditMode: enabled })
  },

  hasChanges: () => {
    const { pendingChanges, deletedRows, insertedRows } = get()
    return pendingChanges.size > 0 || deletedRows.size > 0 || insertedRows.size > 0
  },

  getChangedRows: () => {
    const { pendingChanges } = get()
    return Array.from(pendingChanges.values())
  },

  getCellChange: (rowIndex, columnName) => {
    const { pendingChanges } = get()
    const rowChange = pendingChanges.get(rowIndex)
    return rowChange?.changes[columnName] || null
  },

  isRowDeleted: (rowIndex) => {
    return get().deletedRows.has(rowIndex)
  },

  isRowInserted: (rowIndex) => {
    return get().insertedRows.has(rowIndex)
  },

  generateUpdateSQL: () => {
    const { tableName, schemaName, primaryKeyColumns, pendingChanges } = get()
    if (!tableName) return []

    const fullTableName = schemaName ? `[${schemaName}].[${tableName}]` : `[${tableName}]`
    const statements: string[] = []

    pendingChanges.forEach((rowChange) => {
      if (Object.keys(rowChange.changes).length === 0) return

      const setClauses = Object.values(rowChange.changes)
        .map((change) => {
          const value = change.newValue === null ? 'NULL' : `N'${change.newValue.replace(/'/g, "''")}'`
          return `[${change.columnName}] = ${value}`
        })
        .join(', ')

      // Build WHERE clause using primary keys or all original data columns
      const whereColumns = primaryKeyColumns.length > 0
        ? primaryKeyColumns
        : Object.keys(rowChange.originalData).filter((k) => !k.startsWith('__'))

      const whereClauses = whereColumns
        .map((col) => {
          // First check if column was changed, use original value
          const change = rowChange.changes[col]
          const value = change?.originalValue ?? rowChange.originalData[col] ?? null
          if (value === null) {
            return `[${col}] IS NULL`
          }
          return `[${col}] = N'${String(value).replace(/'/g, "''")}'`
        })
        .join(' AND ')

      if (whereClauses) {
        statements.push(`UPDATE ${fullTableName} SET ${setClauses} WHERE ${whereClauses};`)
      }
    })

    return statements
  },

  generateInsertSQL: () => {
    const { tableName, schemaName, insertedRows } = get()
    if (!tableName) return []

    const fullTableName = schemaName ? `[${schemaName}].[${tableName}]` : `[${tableName}]`
    const statements: string[] = []

    insertedRows.forEach((rowData) => {
      const columns = Object.keys(rowData).filter((k) => !k.startsWith('__'))
      const values = columns.map((col) => {
        const value = rowData[col]
        return value === null ? 'NULL' : `N'${value.replace(/'/g, "''")}'`
      })

      statements.push(`INSERT INTO ${fullTableName} ([${columns.join('], [')}]) VALUES (${values.join(', ')});`)
    })

    return statements
  },

  generateDeleteSQL: () => {
    const { tableName, schemaName, primaryKeyColumns, deletedRows } = get()
    if (!tableName) return []

    const fullTableName = schemaName ? `[${schemaName}].[${tableName}]` : `[${tableName}]`
    const statements: string[] = []

    deletedRows.forEach((rowData) => {
      // Build WHERE clause using primary key columns or all columns if no PK
      const whereColumns = primaryKeyColumns.length > 0
        ? primaryKeyColumns
        : Object.keys(rowData).filter((k) => !k.startsWith('__'))

      const whereClauses = whereColumns
        .map((col) => {
          const value = rowData[col]
          if (value === null || value === undefined) {
            return `[${col}] IS NULL`
          }
          return `[${col}] = N'${String(value).replace(/'/g, "''")}'`
        })
        .join(' AND ')

      if (whereClauses) {
        statements.push(`DELETE FROM ${fullTableName} WHERE ${whereClauses};`)
      }
    })

    return statements
  },
}))
