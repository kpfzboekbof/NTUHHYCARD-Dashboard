import { parseExpr, ExprError } from './expr';
import type { CatalogDoc, WorkUnit } from './types';

/**
 * Structural validation for a catalog.
 *
 * The catalog is what makes field-level responsibility editable instead of
 * hardcoded, which also means a bad edit could flip thousands of cells. Every
 * problem that can be caught without talking to REDCap is caught here; field
 * names are checked against the synced data dictionary separately.
 */

export interface CatalogIssue {
  unitId?: string;
  message: string;
}

/** Dependency types that can stop work from starting. */
const BLOCKING = new Set(['data_gate', 'verify_after']);

function validateCompletionRule(unit: WorkUnit, issues: CatalogIssue[]): void {
  const rule = unit.completionRule;

  const expectedKind: Record<string, WorkUnit['kind'][]> = {
    complete_field: ['full_form'],
    required_fields: ['field_group'],
    verify: ['verify'],
    derived_field: ['derived_field'],
    adjudication: ['adjudication'],
  };
  if (!expectedKind[rule.type]?.includes(unit.kind)) {
    issues.push({ unitId: unit.unitId, message: `kind「${unit.kind}」與完成規則「${rule.type}」不相符` });
  }

  if (rule.type === 'required_fields') {
    if (rule.variants.length === 0) {
      issues.push({ unitId: unit.unitId, message: '必填欄位規則沒有任何 variant' });
      return;
    }
    rule.variants.forEach((variant, index) => {
      if (variant.fields.length === 0) {
        issues.push({ unitId: unit.unitId, message: `variant ${index} 沒有列出任何欄位` });
      }
      const isLast = index === rule.variants.length - 1;
      if (variant.when === 'else') {
        if (!isLast) {
          issues.push({ unitId: unit.unitId, message: "「else」variant 必須放在最後" });
        }
        return;
      }
      try {
        parseExpr(variant.when);
      } catch (error) {
        const detail = error instanceof ExprError ? error.message : String(error);
        issues.push({ unitId: unit.unitId, message: `variant ${index} 條件無法解析：${detail}` });
      }
    });
    if (rule.variants[rule.variants.length - 1].when !== 'else') {
      issues.push({ unitId: unit.unitId, message: '必填欄位規則需要一個「else」variant 作為預設' });
    }
  }

  if (rule.type === 'adjudication') {
    const { minVotes, dissenterMajorityMin, allowSingleDissenter } = rule.consensusRule;
    if (minVotes < 1) {
      issues.push({ unitId: unit.unitId, message: 'minVotes 必須至少為 1' });
    }
    if (allowSingleDissenter && dissenterMajorityMin < minVotes) {
      issues.push({
        unitId: unit.unitId,
        message: `dissenterMajorityMin (${dissenterMajorityMin}) 小於 minVotes (${minVotes})，會讓有異議的個案比全數同意更容易通過`,
      });
    }
  }
}

/**
 * Find a cycle among blocking dependencies. A cycle would make every unit on
 * it permanently blocked, with no way to tell from the UI why.
 */
function findDependencyCycle(units: WorkUnit[]): string[] | null {
  const byId = new Map(units.map(u => [u.unitId, u]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];

  function walk(unitId: string): string[] | null {
    if (done.has(unitId)) return null;
    if (visiting.has(unitId)) {
      return [...stack.slice(stack.indexOf(unitId)), unitId];
    }

    visiting.add(unitId);
    stack.push(unitId);
    for (const dep of byId.get(unitId)?.dependencies ?? []) {
      if (!BLOCKING.has(dep.type)) continue;
      if (!byId.has(dep.unitId)) continue;
      const cycle = walk(dep.unitId);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(unitId);
    done.add(unitId);
    return null;
  }

  for (const unit of units) {
    const cycle = walk(unit.unitId);
    if (cycle) return cycle;
  }
  return null;
}

export function validateCatalog(catalog: CatalogDoc): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const { units } = catalog;

  if (units.length === 0) {
    issues.push({ message: '目錄不能沒有任何工作單元' });
    return issues;
  }

  const seen = new Set<string>();
  for (const unit of units) {
    if (seen.has(unit.unitId)) {
      issues.push({ unitId: unit.unitId, message: '重複的 unitId' });
    }
    seen.add(unit.unitId);
  }

  for (const unit of units) {
    if (!unit.unitId || !unit.label || !unit.redcapForm || !unit.deepLinkPage) {
      issues.push({ unitId: unit.unitId, message: 'unitId / label / redcapForm / deepLinkPage 都是必填' });
    }

    try {
      parseExpr(unit.applicability.expr);
    } catch (error) {
      const detail = error instanceof ExprError ? error.message : String(error);
      issues.push({ unitId: unit.unitId, message: `適用條件無法解析：${detail}` });
    }

    for (const gate of unit.applicability.gatingFields) {
      if (!seen.has(gate.enteredByUnit) && !units.some(u => u.unitId === gate.enteredByUnit)) {
        issues.push({
          unitId: unit.unitId,
          message: `gating 欄位 ${gate.field} 指向不存在的單元 ${gate.enteredByUnit}`,
        });
      }
    }

    for (const dep of unit.dependencies) {
      if (!units.some(u => u.unitId === dep.unitId)) {
        issues.push({ unitId: unit.unitId, message: `相依於不存在的單元 ${dep.unitId}` });
      }
      if (dep.unitId === unit.unitId) {
        issues.push({ unitId: unit.unitId, message: '單元不能相依於自己' });
      }
    }

    validateCompletionRule(unit, issues);
  }

  const cycle = findDependencyCycle(units);
  if (cycle) {
    issues.push({ message: `相依關係形成循環：${cycle.join(' → ')}` });
  }

  const { staleDays, gradeThresholds } = catalog.settings;
  if (staleDays < 1) {
    issues.push({ message: 'staleDays 必須至少為 1' });
  }
  const [excellent, good, needsWork] = gradeThresholds;
  if (!(excellent > good && good > needsWork)) {
    issues.push({ message: `成績門檻必須遞減，收到 ${gradeThresholds.join(' / ')}` });
  }

  return issues;
}

/**
 * Fields the catalog references but the REDCap data dictionary does not have —
 * how a REDCap schema change surfaces instead of silently breaking derivation.
 */
export function findUnknownFields(catalog: CatalogDoc, knownFields: Set<string>): CatalogIssue[] {
  const issues: CatalogIssue[] = [];

  for (const unit of catalog.units) {
    const referenced = new Set<string>();

    for (const gate of unit.applicability.gatingFields) referenced.add(gate.field);

    const rule = unit.completionRule;
    if (rule.type === 'complete_field' || rule.type === 'verify') referenced.add(rule.completeField);
    if (rule.type === 'derived_field') referenced.add(rule.watchField);
    if (rule.type === 'required_fields') {
      for (const variant of rule.variants) for (const field of variant.fields) referenced.add(field);
    }

    for (const field of referenced) {
      if (!knownFields.has(field)) {
        issues.push({ unitId: unit.unitId, message: `REDCap 沒有欄位 ${field}` });
      }
    }
  }

  return issues;
}
