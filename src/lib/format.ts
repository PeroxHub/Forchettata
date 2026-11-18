const two = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const upTo2 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 })

/** "7,85" */
export const fmtMean = (n: number | null | undefined) => (n == null ? '—' : two.format(Number(n)))
/** "7" o "7,5" */
export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : upTo2.format(Number(n)))

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/** Elenco in italiano: "A, B e C" */
export function listIt(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}
