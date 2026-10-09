// Loads a scenario from local JSON files (offline mode).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCENARIOS_DIR = new URL('../../evals/scenarios/', import.meta.url).pathname;

export function loadScenario(name, dir = SCENARIOS_DIR) {
  const read = (f) => JSON.parse(readFileSync(join(dir, name, f), 'utf8'));
  return {
    contacts: read('contacts.json'),
    deals: read('deals.json'),
    billing: read('billing.json'),
    truth: read('ground-truth.json'),
  };
}
