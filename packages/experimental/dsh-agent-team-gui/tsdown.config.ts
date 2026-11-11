import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { clientBundle } from '../../../packages/client/tsdown.client.ts'

const entry = resolve(import.meta.dirname, 'lib/types/index.js')
export default existsSync(entry) ? clientBundle(import.meta.dirname, ['lib/types/index.js']) : []
