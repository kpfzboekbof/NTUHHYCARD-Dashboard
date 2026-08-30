import { evaluate, parseExpr, type ExprContext, type Node, type Tri } from '@/lib/catalog/expr';
import type { CompletionRule, WorkUnit } from '@/lib/catalog/types';
import type {
  AdjudicationSummary,
  BlockReason,
  CellState,
  RecordDerivation,
  RecordSnapshot,
  WorkState,
} from './types';

/**
 * Derives the state of every (record × work unit) cell.
 *
 * Pure: same snapshot and catalog in, same states out. Comparing two runs is
 * what produces handoff events, so this function must have no hidden inputs.
 */

export interface DeriveOptions {
  units: WorkUnit[];
  /** Cutoff for a batch slug used by `batch('slug').cutoff`, or null if unknown. */
  batchCutoff?: (slug: string) => number | null;
  /** Etiology consensus for this record, when the catalog has an adjudication unit. */
  adjudication?: AdjudicationSummary;
}

const EXPR_CACHE = new Map<string, Node>();

function compile(expr: string): Node {
  let node = EXPR_CACHE.get(expr);
  if (!node) {
    node = parseExpr(expr);
    EXPR_CACHE.set(expr, node);
  }
  return node;
}

/** Highest _complete value across the main and repeating rows, as today. */
export function completeValue(snapshot: RecordSnapshot, field: string): string {
  const candidates = [snapshot.main[field] ?? '', ...(snapshot.repeats[field] ?? [])];
  let best = '';
  for (const value of candidates) {
    if (value === '') continue;
    if (best === '' || Number(value) > Number(best)) best = value;
  }
  return best;
}

function isFilled(snapshot: RecordSnapshot, field: string, checkboxFields: Set<string>): boolean {
  if (checkboxFields.has(field)) {
    // REDCap exports checkboxes as `field___option`; any ticked option counts.
    return Object.entries(snapshot.main).some(
      ([key, value]) => key.startsWith(`${field}___`) && value === '1',
    );
  }
  return (snapshot.main[field] ?? '') !== '';
}

function makeExprContext(
  snapshot: RecordSnapshot,
  unit: WorkUnit,
  batchCutoff: (slug: string) => number | null,
): ExprContext {
  const aggregation = new Map(
    unit.applicability.gatingFields.map(gate => [gate.field, gate.aggregation ?? 'main']),
  );

  return {
    fieldValues(field) {
      const main = snapshot.main[field] ?? '';
      if (aggregation.get(field) !== 'any') return [main];
      return [main, ...(snapshot.repeats[field] ?? [])];
    },
    studyIdNum: Number.parseInt(snapshot.studyId, 10) || 0,
    batchCutoff,
  };
}

/** Fields required for this record, honouring the er_arrival-style variants. */
function activeVariant(
  rule: Extract<CompletionRule, { type: 'required_fields' }>,
  snapshot: RecordSnapshot,
  ctx: ExprContext,
) {
  for (const variant of rule.variants) {
    if (variant.when === 'else') return variant;
    // An unknown condition falls through to the next variant, ending at `else`.
    if (evaluate(compile(variant.when), ctx) === 'true') return variant;
  }
  return rule.variants[rule.variants.length - 1];
}

function verifierOf(unit: WorkUnit, units: WorkUnit[]): WorkUnit | undefined {
  return units.find(candidate =>
    candidate.dependencies.some(dep => dep.unitId === unit.unitId && dep.type === 'verify_after'),
  );
}

function completionState(
  unit: WorkUnit,
  snapshot: RecordSnapshot,
  options: Required<Pick<DeriveOptions, 'units'>> & DeriveOptions,
  ctx: ExprContext,
): { state: WorkState; blockReason?: BlockReason } {
  const rule = unit.completionRule;

  switch (rule.type) {
    case 'complete_field':
    case 'verify': {
      const value = completeValue(snapshot, rule.completeField);
      if (value === '2') return { state: 'complete' };
      if (value === '1') return { state: 'in_progress' };
      return { state: 'ready' };
    }

    case 'required_fields': {
      const variant = activeVariant(rule, snapshot, ctx);
      const checkboxes = new Set(variant.checkboxFields ?? []);
      const filled = variant.fields.filter(field => isFilled(snapshot, field, checkboxes)).length;

      if (filled === 0) return { state: 'ready' };
      if (filled < variant.fields.length) return { state: 'in_progress' };

      // Fully entered. If someone has to sign this off, it is their turn now —
      // this is the assistant→doctor handoff that used to be only a convention.
      const verifier = verifierOf(unit, options.units);
      if (!verifier) return { state: 'complete' };

      const verifierRule = verifier.completionRule;
      const verified =
        (verifierRule.type === 'verify' || verifierRule.type === 'complete_field') &&
        completeValue(snapshot, verifierRule.completeField) === '2';

      return { state: verified ? 'complete' : 'entered_awaiting_verify' };
    }

    case 'derived_field': {
      if ((snapshot.main[rule.watchField] ?? '') !== '') return { state: 'complete' };
      const adjudication = options.adjudication;
      if (adjudication?.consensus === 'green' && adjudication.mappable) return { state: 'ready' };
      return { state: 'blocked', blockReason: { kind: 'awaiting_consensus' } };
    }

    case 'adjudication': {
      const adjudication = options.adjudication;
      if (!adjudication) return { state: 'ready' };
      if (adjudication.finalWritten) return { state: 'complete' };
      if (adjudication.completedVotes < rule.consensusRule.minVotes) return { state: 'in_progress' };
      // Enough votes are in: green-and-mappable waits for the batch upload,
      // red and green-but-unmappable wait for the consensus meeting. Both are
      // held here so neither can fall out of the queue unnoticed.
      return { state: 'entered_awaiting_verify' };
    }
  }
}

function dependencyBlock(
  unit: WorkUnit,
  stateOf: (unitId: string) => WorkState,
): BlockReason | undefined {
  for (const dep of unit.dependencies) {
    if (dep.type === 'soft_order') continue;

    const upstream = stateOf(dep.unitId);
    if (upstream === 'not_applicable') continue;

    const satisfied =
      dep.type === 'verify_after'
        ? upstream === 'entered_awaiting_verify' || upstream === 'complete'
        : upstream === 'complete';

    if (!satisfied) return { kind: 'awaiting_unit', unitId: dep.unitId };
  }
  return undefined;
}

function applicabilityBlock(unit: WorkUnit, applicable: Tri): BlockReason | undefined {
  if (applicable !== 'unknown') return undefined;

  // Name the field and its owner so the block is actionable, not just grey.
  const gate = unit.applicability.gatingFields[0];
  return gate
    ? { kind: 'awaiting_gate', field: gate.field, enteredByUnit: gate.enteredByUnit }
    : { kind: 'awaiting_config', detail: `無法判定「${unit.label}」的適用條件` };
}

/**
 * Derive every cell for one record.
 *
 * Order follows the spec: exclusion, then applicability, then dependencies,
 * then the unit's own completion rule.
 */
export function deriveRecord(snapshot: RecordSnapshot, options: DeriveOptions): RecordDerivation {
  const { units } = options;
  const batchCutoff = options.batchCutoff ?? (() => null);

  const exclusion = snapshot.main.exclusion ?? '';
  const excluded = exclusion !== '' && exclusion !== '0';
  const screeningPending = exclusion === '';
  const hospital = Number.parseInt(snapshot.main.hospital ?? '0', 10) || 0;

  if (excluded) {
    return {
      studyId: snapshot.studyId,
      hospital,
      excluded: true,
      screeningPending: false,
      cells: units.map(unit => ({
        studyId: snapshot.studyId,
        unitId: unit.unitId,
        state: 'not_applicable' as const,
        blockReason: { kind: 'excluded' } as const,
      })),
    };
  }

  const byId = new Map(units.map(unit => [unit.unitId, unit]));
  const resolved = new Map<string, CellState>();
  const inProgress = new Set<string>();

  function stateOf(unitId: string): WorkState {
    return resolve(unitId).state;
  }

  function resolve(unitId: string): CellState {
    const cached = resolved.get(unitId);
    if (cached) return cached;

    const unit = byId.get(unitId);
    if (!unit) {
      // Only reachable from a dangling dependency, which validation rejects.
      const cell: CellState = {
        studyId: snapshot.studyId,
        unitId,
        state: 'blocked',
        blockReason: { kind: 'awaiting_config', detail: `目錄中沒有單元 ${unitId}` },
      };
      resolved.set(unitId, cell);
      return cell;
    }

    if (inProgress.has(unitId)) {
      // Validation rejects dependency cycles; this keeps a bad catalog from
      // hanging the derivation rather than surfacing as a blocked cell.
      const cell: CellState = {
        studyId: snapshot.studyId,
        unitId,
        state: 'blocked',
        blockReason: { kind: 'awaiting_config', detail: `相依關係形成循環：${unitId}` },
      };
      resolved.set(unitId, cell);
      return cell;
    }
    inProgress.add(unitId);

    let cell: CellState;
    try {
      cell = derive(unit);
    } catch (error) {
      // A malformed expression is rejected when the catalog is saved, but one
      // stored before that validation existed must not take the whole matrix
      // down with it: block just this cell and name the reason.
      const detail = error instanceof Error ? error.message : String(error);
      cell = {
        studyId: snapshot.studyId,
        unitId,
        state: 'blocked',
        blockReason: { kind: 'awaiting_config', detail },
      };
    }
    inProgress.delete(unitId);
    resolved.set(unitId, cell);
    return cell;
  }

  function derive(unit: WorkUnit): CellState {
    const base = { studyId: snapshot.studyId, unitId: unit.unitId };
    const ctx = makeExprContext(snapshot, unit, batchCutoff);

    const applicable = evaluate(compile(unit.applicability.expr), ctx);
    if (applicable === 'false') {
      return { ...base, state: 'not_applicable' };
    }

    const gateBlock = applicabilityBlock(unit, applicable);
    if (gateBlock) return { ...base, state: 'blocked', blockReason: gateBlock };

    const completion = completionState(unit, snapshot, options, ctx);

    // A verifier who has already signed off counts as complete even if the
    // upstream field group is unfinished: that is a real (out-of-order) state,
    // and hiding it as "blocked" would understate the work actually done. The
    // A0 quality check is what flags the ordering violation.
    if (unit.kind === 'verify' && completion.state === 'complete') {
      return { ...base, ...completion };
    }

    const depBlock = dependencyBlock(unit, stateOf);
    if (depBlock) return { ...base, state: 'blocked', blockReason: depBlock };

    return { ...base, ...completion };
  }

  return {
    studyId: snapshot.studyId,
    hospital,
    excluded: false,
    screeningPending,
    cells: units.map(unit => resolve(unit.unitId)),
  };
}
