import { summary } from './core.test.js';
const s = summary();
for (const r of s.results) print((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : '\n      → ' + r.error));
print(`\n${s.passed}/${s.total} pruebas correctas`);
if (s.failed.length) throw new Error(`${s.failed.length} pruebas fallaron`);
