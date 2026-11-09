// Field-by-field merge. Each write carries a logical clock string `t` (sortable); a field takes the
// value of the write with the highest clock it has seen. Same rule on the server and on every device,
// so any order of delivery ends in the same state.

export const KINDS = new Set(['task', 'board', 'pref']);

// row: { data: {...}, vers: {...} } or null. op: { k, id, f: {field: value}, t }.
// Returns { data, vers, changed }.
export function applyOp(row, op) {
  const data = row ? { ...row.data } : {};
  const vers = row ? { ...row.vers } : {};
  let changed = false;
  for (const [field, value] of Object.entries(op.f || {})) {
    if (field === 'id') continue;
    if (!vers[field] || op.t > vers[field]) {
      data[field] = value;
      vers[field] = op.t;
      changed = true;
    }
  }
  return { data, vers, changed };
}

export function validOp(op) {
  return op && KINDS.has(op.k) && typeof op.id === 'string' && op.id.length > 0 && op.id.length <= 64
    && typeof op.t === 'string' && op.t.length <= 64 && op.f && typeof op.f === 'object' && !Array.isArray(op.f)
    && JSON.stringify(op.f).length <= 20000;
}
