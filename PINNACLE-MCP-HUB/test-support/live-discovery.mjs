import { createSystemAppGate } from '../src/app-gate.ts'
import { discoverModules } from '../src/discovery.ts'
import { pack } from '../../pack-aec/index.js'

const gate = createSystemAppGate()
const results = await discoverModules(pack.modules, gate)
let high = 0
for (const r of results) {
  if (r.confidence === 'high') high++
  console.log(`${r.id.padEnd(10)} | conf=${r.confidence.padEnd(6)} | cmd=${r.command === null ? '(none)' : r.command} | appInstalled=${r.appInstalled} | appRunning=${r.appRunning} | unsupported=${r.unsupported}`)
  for (const e of r.evidence) console.log(`      ${e}`)
}
console.log(`\nSUMMARY: ${high}/${results.length} high confidence`)
