import { createLucideIcon } from 'lucide-react';

// Linked cartridges distinguish the Stubber from energy weapons at small sizes.
export const StubberIcon = createLucideIcon('Stubber', [
  ['path', { d: 'M3 8 5 3l2 5v12H3ZM10 8l2-5 2 5v12h-4ZM17 8l2-5 2 5v12h-4Z', key: 'cartridges' }],
  ['path', { d: 'M3 9h4m3 0h4m3 0h4M2 13h20M2 16h20', key: 'belt' }],
]);
