/**
 * Serialize an EffectManifest object to YAML string.
 * Used when forking from a stored manifest (no server-side YAML available).
 */
export function manifestToYaml(m: Record<string, unknown>): string {
  const lines: string[] = []

  const scalarInline = (v: unknown): string => {
    if (typeof v === 'string') {
      if (v.match(/[:#{}[\],&*?|>!%@`]/)) return `"${v}"`
      return v
    }
    return String(v)
  }

  const writeValue = (key: string, value: unknown, indent: number) => {
    const pad = '  '.repeat(indent)
    if (value === null || value === undefined) return

    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) {
      lines.push(`${pad}${key}: {}`)
      return
    }

    if (Array.isArray(value) && value.length === 0) {
      lines.push(`${pad}${key}: []`)
      return
    }

    if (typeof value === 'string' && (value.includes('\n') || value.length > 60)) {
      const innerPad = '  '.repeat(indent + 1)
      lines.push(`${pad}${key}: >`)
      lines.push(`${innerPad}${value.replace(/\n/g, `\n${innerPad}`).trim()}`)
    } else if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`)
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          const entries = Object.entries(item as Record<string, unknown>)
          const [first, ...rest] = entries
          lines.push(`${pad}  - ${first![0]}: ${scalarInline(first![1])}`)
          for (const [k, v] of rest) {
            lines.push(`${pad}    ${k}: ${scalarInline(v)}`)
          }
        } else {
          lines.push(`${pad}  - ${scalarInline(item)}`)
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${pad}${key}:`)
      writeObj(value as Record<string, unknown>, indent + 1)
    } else {
      lines.push(`${pad}${key}: ${scalarInline(value)}`)
    }
  }

  const writeObj = (obj: Record<string, unknown>, indent: number) => {
    for (const [key, value] of Object.entries(obj)) {
      writeValue(key, value, indent)
    }
  }

  writeObj(m, 0)
  return lines.join('\n') + '\n'
}
