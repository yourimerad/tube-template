// Tiny JSON-Schema validator (no dependencies) for the subset used by site.config.schema.json:
// type (incl. arrays of types, "integer"), properties, required, additionalProperties (bool | schema),
// enum, const, pattern, minimum, maximum, minLength, maxLength, items, minItems, maxItems, $ref (#/...).
// Returns a list of "path: message" strings (empty = valid).
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => t === typeOf(v) || (t === 'number' && typeof v === 'number') || (t === 'integer' && Number.isInteger(v));

export function validate(schema, value, root = schema, path = '$') {
  const errs = [];
  if (schema === true || schema === undefined) return errs;
  if (schema === false) return [`${path}: not allowed`];
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], root);
    if (!target) return [`${path}: unresolved $ref ${schema.$ref}`];
    return validate(target, value, root, path);
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some(t => isType(value, t))) return [`${path}: expected ${types.join(' | ')}, got ${typeOf(value)}`];
  }
  if (schema.enum && !schema.enum.some(e => e === value)) errs.push(`${path}: must be one of ${schema.enum.map(e => JSON.stringify(e)).join(', ')}`);
  if ('const' in schema && schema.const !== value) errs.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) errs.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) errs.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errs.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, root, `${path}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${path}: missing required "${k}"`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) errs.push(...validate(props[k], v, root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unknown key "${k}"`);
      else if (typeof schema.additionalProperties === 'object') errs.push(...validate(schema.additionalProperties, v, root, `${path}.${k}`));
    }
  }
  return errs;
}
