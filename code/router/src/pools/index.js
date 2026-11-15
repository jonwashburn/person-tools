// The registry of outside pools (code/router/ADAPTERS.md). One line per adapter.
import { adapter as prolific } from './prolific.js';
export const ADAPTERS = { prolific };
export function getAdapter(name) { return ADAPTERS[name] || null; }
