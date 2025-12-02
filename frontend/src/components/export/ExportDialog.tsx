import { useState, useCallback } from 'react'
import type { ResultSet } from '../../types'
import styles from './ExportDialog.module.css'

interface ExportDialogProps {
  isOpen: boolean
  onClose: () => void
  resultSet: ResultSet | null
}

type ExportFormat = 'csv' | 'json' | 'sql' | 'html'

interface ExportOptions {
  format: ExportFormat
  includeHeaders: boolean
  delimiter: string
  nullValue: string
  tableName: string
}

export function ExportDialog({ isOpen, onClose, resultSet }: ExportDialogProps) {
  const [options, setOptions] = useState<ExportOptions>({
    format: 'csv',
    includeHeaders: true,
    delimiter: ',',
    nullValue: 'NULL',
    tableName: 'table_name',
  })
  const [copied, setCopied] = useState(false)

  const generateExport = useCallback((): string => {
    if (!resultSet) return ''

    const { columns, rows } = resultSet
    const { format, includeHeaders, delimiter, nullValue, tableName } = options

    switch (format) {
      case 'csv': {
        const lines: string[] = []
        if (includeHeaders) {
          lines.push(columns.map((c) => `"${c.name}"`).join(delimiter))
        }
        rows.forEach((row) => {
          const values = row.map((val) => {
            if (val === null || val === '') return nullValue
            // Escape quotes
            const escaped = String(val).replace(/"/g, '""')
            return `"${escaped}"`
          })
          lines.push(values.join(delimiter))
        })
        return lines.join('\n')
      }

      case 'json': {
        const data = rows.map((row) => {
          const obj: Record<string, string | null> = {}
          columns.forEach((col, idx) => {
            const val = row[idx]
            obj[col.name] = val === '' ? null : val
          })
          return obj
        })
        return JSON.stringify(data, null, 2)
      }

      case 'sql': {
        const lines: string[] = []
        rows.forEach((row) => {
          const values = row.map((val) => {
            if (val === null || val === '') return 'NULL'
            const escaped = String(val).replace(/'/g, "''")
            return `N'${escaped}'`
          })
          lines.push(
            `INSERT INTO [${tableName}] ([${columns.map((c) => c.name).join('], [')}]) VALUES (${values.join(', ')});`
          )
        })
        return lines.join('\n')
      }

      case 'html': {
        const headerRow = includeHeaders
          ? `<tr>${columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join('')}</tr>`
          : ''
        const dataRows = rows
          .map((row) => {
            const cells = row.map((val) => {
              const display = val === null || val === '' ? nullValue : val
              return `<td>${escapeHtml(String(display))}</td>`
            })
            return `<tr>${cells.join('')}</tr>`
          })
          .join('\n')
        return `<table>\n<thead>\n${headerRow}\n</thead>\n<tbody>\n${dataRows}\n</tbody>\n</table>`
      }

      default:
        return ''
    }
  }, [resultSet, options])

  const handleCopy = useCallback(async () => {
    const text = generateExport()
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [generateExport])

  const handleDownload = useCallback(() => {
    const text = generateExport()
    const extensions: Record<ExportFormat, string> = {
      csv: 'csv',
      json: 'json',
      sql: 'sql',
      html: 'html',
    }
    const mimeTypes: Record<ExportFormat, string> = {
      csv: 'text/csv',
      json: 'application/json',
      sql: 'text/plain',
      html: 'text/html',
    }
    const blob = new Blob([text], { type: mimeTypes[options.format] })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export.${extensions[options.format]}`
    a.click()
    URL.revokeObjectURL(url)
  }, [generateExport, options.format])

  if (!isOpen) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Export Data</h2>
          <button className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.field}>
            <label>Format</label>
            <select
              value={options.format}
              onChange={(e) => setOptions({ ...options, format: e.target.value as ExportFormat })}
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
              <option value="sql">SQL INSERT</option>
              <option value="html">HTML Table</option>
            </select>
          </div>

          {options.format === 'csv' && (
            <div className={styles.field}>
              <label>Delimiter</label>
              <select
                value={options.delimiter}
                onChange={(e) => setOptions({ ...options, delimiter: e.target.value })}
              >
                <option value=",">Comma (,)</option>
                <option value="	">Tab</option>
                <option value=";">Semicolon (;)</option>
                <option value="|">Pipe (|)</option>
              </select>
            </div>
          )}

          {(options.format === 'csv' || options.format === 'html') && (
            <div className={styles.field}>
              <label>
                <input
                  type="checkbox"
                  checked={options.includeHeaders}
                  onChange={(e) => setOptions({ ...options, includeHeaders: e.target.checked })}
                />
                Include headers
              </label>
            </div>
          )}

          {options.format === 'sql' && (
            <div className={styles.field}>
              <label>Table Name</label>
              <input
                type="text"
                value={options.tableName}
                onChange={(e) => setOptions({ ...options, tableName: e.target.value })}
              />
            </div>
          )}

          <div className={styles.field}>
            <label>NULL Value Display</label>
            <input
              type="text"
              value={options.nullValue}
              onChange={(e) => setOptions({ ...options, nullValue: e.target.value })}
            />
          </div>

          <div className={styles.preview}>
            <label>Preview</label>
            <pre>{generateExport().slice(0, 1000)}{generateExport().length > 1000 ? '...' : ''}</pre>
          </div>
        </div>

        <div className={styles.footer}>
          <span className={styles.rowCount}>
            {resultSet ? `${resultSet.rows.length} rows` : 'No data'}
          </span>
          <div className={styles.actions}>
            <button onClick={handleCopy} className={styles.copyButton}>
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
            <button onClick={handleDownload} className={styles.downloadButton}>
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
