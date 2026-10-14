import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

// Real command output captured on a Linux host (see fixtures/README.md).
export const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

export const fixture = (name) => readFileSync(fixturePath(name), 'utf8')
