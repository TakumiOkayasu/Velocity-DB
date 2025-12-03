import { useState, useCallback } from 'react'
import styles from './A5ERImportDialog.module.css'

interface A5ERImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onImport: (tables: A5ERTable[], relations: A5ERRelation[]) => void
}

export interface A5ERTable {
  name: string
  schema: string
  columns: A5ERColumn[]
}

export interface A5ERColumn {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey: boolean
  isForeignKey: boolean
  references?: {
    table: string
    column: string
  }
}

export interface A5ERRelation {
  sourceTable: string
  targetTable: string
  sourceColumn: string
  targetColumn: string
  cardinality: '1:1' | '1:N' | 'N:M'
}

export function A5ERImportDialog({ isOpen, onClose, onImport }: A5ERImportDialogProps) {
  const [fileName, setFileName] = useState<string>('')
  const [parsedTables, setParsedTables] = useState<A5ERTable[]>([])
  const [parsedRelations, setParsedRelations] = useState<A5ERRelation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [generatedDDL, setGeneratedDDL] = useState<string>('')
  const [showDDL, setShowDDL] = useState(false)

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setError(null)

    try {
      const content = await file.text()

      // Parse A5:ER format (simplified XML parsing)
      const { tables, relations } = parseA5ERContent(content)
      setParsedTables(tables)
      setParsedRelations(relations)

      // Generate DDL
      const ddl = generateDDL(tables, relations)
      setGeneratedDDL(ddl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file')
    }
  }, [])

  const handleImport = useCallback(() => {
    onImport(parsedTables, parsedRelations)
    onClose()
  }, [parsedTables, parsedRelations, onImport, onClose])

  const handleCopyDDL = useCallback(async () => {
    await navigator.clipboard.writeText(generatedDDL)
  }, [generatedDDL])

  if (!isOpen) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Import A5:ER File</h2>
          <button className={styles.closeButton} onClick={onClose}>
            ﾃ・          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.fileInput}>
            <label>
              Select .a5er file:
              <input
                type="file"
                accept=".a5er,.xml"
                onChange={handleFileSelect}
              />
            </label>
            {fileName && <span className={styles.fileName}>{fileName}</span>}
          </div>

          {error && <div className={styles.error}>{error}</div>}

          {parsedTables.length > 0 && (
            <div className={styles.summary}>
              <h3>Parsed Content</h3>
              <p>{parsedTables.length} tables, {parsedRelations.length} relations</p>

              <div className={styles.tableList}>
                {parsedTables.map((table) => (
                  <div key={table.name} className={styles.tableItem}>
                    <span className={styles.tableName}>{table.schema ? `${table.schema}.` : ''}{table.name}</span>
                    <span className={styles.columnCount}>{table.columns.length} columns</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={styles.ddlSection}>
            <div className={styles.ddlHeader}>
              <h3>Generated DDL</h3>
              <button onClick={() => setShowDDL(!showDDL)}>
                {showDDL ? 'Hide' : 'Show'}
              </button>
              {generatedDDL && (
                <button onClick={handleCopyDDL}>Copy</button>
              )}
            </div>
            {showDDL && generatedDDL && (
              <pre className={styles.ddlContent}>{generatedDDL}</pre>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button onClick={onClose}>Cancel</button>
          <button
            onClick={handleImport}
            disabled={parsedTables.length === 0}
            className={styles.importButton}
          >
            Import to ER Diagram
          </button>
        </div>
      </div>
    </div>
  )
}

// Parse A5:ER XML format
function parseA5ERContent(content: string): { tables: A5ERTable[]; relations: A5ERRelation[] } {
  const tables: A5ERTable[] = []
  const relations: A5ERRelation[] = []

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(content, 'text/xml')

    // Parse tables (Entity elements)
    const entityElements = doc.querySelectorAll('ENTITY')
    entityElements.forEach((entity) => {
      const tableName = entity.getAttribute('Name') || entity.getAttribute('name') || ''
      const schema = entity.getAttribute('Schema') || entity.getAttribute('schema') || 'dbo'

      const columns: A5ERColumn[] = []
      const attrElements = entity.querySelectorAll('ATTR')

      attrElements.forEach((attr) => {
        const colName = attr.getAttribute('Name') || attr.getAttribute('name') || ''
        const colType = attr.getAttribute('Type') || attr.getAttribute('type') || 'varchar(255)'
        const isPK = attr.getAttribute('PrimaryKey') === '1' || attr.getAttribute('primarykey') === 'true'
        const isNullable = attr.getAttribute('NotNull') !== '1' && attr.getAttribute('notnull') !== 'true'

        columns.push({
          name: colName,
          type: colType,
          nullable: isNullable,
          isPrimaryKey: isPK,
          isForeignKey: false,
        })
      })

      if (tableName) {
        tables.push({ name: tableName, schema, columns })
      }
    })

    // Parse relations (Relation elements)
    const relationElements = doc.querySelectorAll('RELATION')
    relationElements.forEach((rel) => {
      const sourceTable = rel.getAttribute('Entity1') || rel.getAttribute('entity1') || ''
      const targetTable = rel.getAttribute('Entity2') || rel.getAttribute('entity2') || ''
      const cardinality = rel.getAttribute('Cardinality') || '1:N'

      if (sourceTable && targetTable) {
        relations.push({
          sourceTable,
          targetTable,
          sourceColumn: 'id',
          targetColumn: `${sourceTable.toLowerCase()}_id`,
          cardinality: cardinality as '1:1' | '1:N' | 'N:M',
        })
      }
    })
  } catch (err) {
    console.error('Failed to parse A5:ER content:', err)
  }

  return { tables, relations }
}

// Generate SQL Server DDL
function generateDDL(tables: A5ERTable[], relations: A5ERRelation[]): string {
  const lines: string[] = []

  // Create tables
  tables.forEach((table) => {
    const fullName = table.schema ? `[${table.schema}].[${table.name}]` : `[${table.name}]`
    lines.push(`-- Table: ${table.name}`)
    lines.push(`CREATE TABLE ${fullName} (`)

    const columnDefs = table.columns.map((col, idx) => {
      const parts = [`  [${col.name}]`, col.type]
      if (!col.nullable) parts.push('NOT NULL')
      if (col.isPrimaryKey) parts.push('PRIMARY KEY')
      return parts.join(' ') + (idx < table.columns.length - 1 ? ',' : '')
    })

    lines.push(columnDefs.join('\n'))
    lines.push(');')
    lines.push('')
  })

  // Create foreign keys
  relations.forEach((rel) => {
    const sourceTable = tables.find((t) => t.name === rel.sourceTable)
    const targetTable = tables.find((t) => t.name === rel.targetTable)

    if (sourceTable && targetTable) {
      const sourceFull = sourceTable.schema ? `[${sourceTable.schema}].[${sourceTable.name}]` : `[${sourceTable.name}]`
      const targetFull = targetTable.schema ? `[${targetTable.schema}].[${targetTable.name}]` : `[${targetTable.name}]`

      lines.push(`-- Foreign Key: ${rel.sourceTable} -> ${rel.targetTable}`)
      lines.push(`ALTER TABLE ${targetFull}`)
      lines.push(`ADD CONSTRAINT FK_${rel.targetTable}_${rel.sourceTable}`)
      lines.push(`FOREIGN KEY ([${rel.targetColumn}]) REFERENCES ${sourceFull}([${rel.sourceColumn}]);`)
      lines.push('')
    }
  })

  return lines.join('\n')
}
