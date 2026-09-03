/**
 * The derived views by name, and which writes make which of them wrong.
 *
 * Kept as strings in one place so a route can invalidate a view without
 * importing its builder — the etiology write must not pull the whole state
 * engine into its bundle just to name the matrix.
 */

export const VIEW = {
  completion: 'completion',
  matrix: 'state-matrix',
  etiology: 'etiology',
  qc: 'qc',
  ownersProgress: 'owners-progress',
  logging: (months: number) => `logging-${months}`,
  redcapLogs: (months: number) => `redcap-logs-${months}`,
} as const;

/** The month windows the productivity page can ask for. */
export const LOG_MONTHS = [1, 3, 6, 12] as const;

/** Every view key, for a full refresh. */
export function allViewKeys(): string[] {
  return [
    VIEW.completion,
    VIEW.matrix,
    VIEW.etiology,
    VIEW.qc,
    VIEW.ownersProgress,
    ...LOG_MONTHS.map(VIEW.logging),
    ...LOG_MONTHS.map(VIEW.redcapLogs),
  ];
}

/** Views built from other views. */
export const DEPENDENTS: Record<string, string[]> = {
  [VIEW.completion]: [VIEW.qc, ...LOG_MONTHS.map(VIEW.logging)],
  [VIEW.matrix]: [VIEW.ownersProgress],
  [VIEW.redcapLogs(3)]: [VIEW.ownersProgress, VIEW.qc, VIEW.logging(3)],
  [VIEW.redcapLogs(1)]: [VIEW.logging(1)],
  [VIEW.redcapLogs(6)]: [VIEW.logging(6)],
  [VIEW.redcapLogs(12)]: [VIEW.logging(12)],
};

/** The keys plus everything derived from them, deduplicated. */
export function withDependents(keys: string[]): string[] {
  const out = new Set<string>();
  const visit = (key: string) => {
    if (out.has(key)) return;
    out.add(key);
    for (const dependent of DEPENDENTS[key] ?? []) visit(dependent);
  };
  keys.forEach(visit);
  return [...out];
}

/**
 * What a write touches.
 *
 *  - etiology_final: the etiology view itself, the matrix (consensus cells),
 *    and the completion view's Outcome 死因 column.
 *  - a QC batch fix rewrites outcome fields the completion view reads.
 *  - settings (assignments, hidden forms, targets, labelers) are baked into
 *    every REDCap-derived view.
 */
export const WRITE_EFFECTS = {
  etiologyFinal: withDependents([VIEW.etiology, VIEW.matrix, VIEW.completion]),
  qcFix: withDependents([VIEW.qc, VIEW.completion, VIEW.matrix]),
  settings: withDependents([VIEW.completion, VIEW.matrix, VIEW.etiology]),
} as const;
