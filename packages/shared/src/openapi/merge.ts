import type { createDocument } from 'zod-openapi';

export type OpenApiDocument = ReturnType<typeof createDocument>;

type ComponentMap = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isRecord(a) && isRecord(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return keysA.length === keysB.length && keysA.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

/** Rewrites every `$ref: #/components/<section>/<oldName>` according to `renames`. */
function rewriteRefs(node: unknown, section: string, renames: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteRefs(item, section, renames);
    return;
  }
  if (!isRecord(node)) return;
  const ref = node['$ref'];
  if (typeof ref === 'string') {
    const prefix = `#/components/${section}/`;
    if (ref.startsWith(prefix)) {
      const renamed = renames.get(ref.slice(prefix.length));
      if (renamed) node['$ref'] = `${prefix}${renamed}`;
    }
  }
  for (const value of Object.values(node)) rewriteRefs(value, section, renames);
}

/**
 * Merges one component section (schemas, securitySchemes, …) of the `extraDoc`
 * document into `target`. Identical entries are deduplicated; conflicting
 * names are renamed inside `extraDoc` — every `$ref` in the whole document,
 * paths included, is rewritten to the new name before being copied over.
 */
function mergeComponentSection(
  target: Record<string, ComponentMap | undefined>,
  extraDoc: Record<string, unknown>,
  section: string,
): void {
  const extraComponents = extraDoc.components;
  if (!isRecord(extraComponents)) return;
  const extraSection = extraComponents[section];
  if (!isRecord(extraSection)) return;

  const targetSection = (target[section] ??= {});
  const renames = new Map<string, string>();
  for (const name of Object.keys(extraSection)) {
    if (name in targetSection && !deepEqual(targetSection[name], extraSection[name])) {
      let candidate = name;
      let suffix = 2;
      while (candidate in targetSection || candidate in extraSection) {
        candidate = `${name}_${suffix}`;
        suffix += 1;
      }
      renames.set(name, candidate);
    }
  }
  if (renames.size > 0) rewriteRefs(extraDoc, section, renames);

  for (const [name, schema] of Object.entries(extraSection)) {
    const finalName = renames.get(name) ?? name;
    if (!(finalName in targetSection)) targetSection[finalName] = schema;
  }
}

const COMPONENT_SECTIONS = ['schemas', 'responses', 'parameters', 'securitySchemes'] as const;

/**
 * Combines several services' OpenAPI documents into one, as if the routes all
 * belonged to a single app (the gateway view). `base` wins every conflict:
 * paths already present are kept as-is, and colliding component names from the
 * extra documents are renamed (their `$ref`s rewritten to match).
 */
export function mergeOpenApiDocuments(
  base: OpenApiDocument,
  extras: OpenApiDocument[],
): OpenApiDocument {
  const merged = structuredClone(base);
  const mergedPaths = (merged.paths ??= {}) as Record<string, unknown>;
  const mergedComponents = (merged.components ??= {}) as Record<string, ComponentMap | undefined>;

  for (const original of extras) {
    const extra = structuredClone(original) as unknown as Record<string, unknown>;

    for (const section of COMPONENT_SECTIONS) {
      mergeComponentSection(mergedComponents, extra, section);
    }

    if (isRecord(extra.paths)) {
      for (const [path, item] of Object.entries(extra.paths)) {
        if (!(path in mergedPaths)) mergedPaths[path] = item;
      }
    }
  }

  return merged;
}
