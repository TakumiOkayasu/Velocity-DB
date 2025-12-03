import type { ERTableNode, Column } from '../../types'

// Auto-layout helper function
export function autoLayoutTables(
  tables: { name: string; columns: Column[] }[]
): ERTableNode[] {
  const nodeWidth = 200
  const nodeHeight = 150
  const horizontalGap = 50
  const verticalGap = 50
  const columns = 4

  return tables.map((table, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)

    return {
      id: table.name,
      type: 'table' as const,
      data: {
        tableName: table.name,
        columns: table.columns,
      },
      position: {
        x: col * (nodeWidth + horizontalGap),
        y: row * (nodeHeight + verticalGap),
      },
    }
  })
}
