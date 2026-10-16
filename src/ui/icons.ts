// Ability and tool icons. Human things are straight lines and right angles, so these are too.
// 24×24 viewBox, stroked with the current colour.

const P: Record<string, string> = {
  rifle: 'M2 11h15v2H2zM17 10h5v2h-5M6 13v4h2v-4M12 13l1 4h2l-1-4',
  longrifle: 'M1 12h20v1.5H1zM8 8h7v3H8zM4 13.5v4h2v-4M21 11h2v2h-2',
  pistol: 'M5 9h12v3H5zM7 12v6h3v-6M17 10h2v1h-2',
  grenade: 'M7 8h10v12H7zM10 5h4v3h-4M14 6h4M7 12h10M7 16h10',
  flamer: 'M3 9h6v9H3zM9 12h9v3H9zM18 11l4 2.5-4 2.5',
  knife: 'M4 20l3-3M7 17l2 2M8 16L19 5l1 1L9 17',
  overwatch: 'M3 3h5M3 3v5M21 3h-5M21 3v5M3 21h5M3 21v-5M21 21h-5M21 21v-5M12 8v8M8 12h8',
  stabilise: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  endturn: 'M5 6l6 6-6 6M12 6l6 6-6 6',
  lowwall: 'M3 14h18v6H3zM3 17h18M9 14v3M15 14v3M6 17v3M12 17v3M18 17v3',
  wall: 'M5 4h14v16H5zM5 9h14M5 14h14M12 4v5M9 9v5M15 9v5M12 14v6',
  clear: 'M4 20L18 6M14 4h6v6M6 8l3 3M9 5l3 3',
  repair: 'M4 20l8-8M12 12l2-2 4 4-2 2zM14 10l3-3h3v3l-3 3',
  lab: 'M9 3h6M10 3v6l-5 11h14l-5-11V3M7 15h10',
  infirmary: 'M4 4h16v16H4zM10 7h4v4h4v2h-4v4h-4v-4H6v-2h4z',
  workshop: 'M3 20V9l6 4V9l6 4V5h6v15zM7 16h2M12 16h2M17 16h2',
  undo: 'M9 6L4 11l5 5M4 11h11a5 5 0 0 1 0 10h-3',
  log: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  next: 'M4 5h10v14H4zM14 12h7M18 9l3 3-3 3',
  settings: 'M4 6h10M18 6h2M14 4v4M4 12h3M11 12h9M7 10v4M4 18h12M20 18h0M16 16v4',
};

export function icon(name: keyof typeof P | string, size = 24): string {
  const d = P[name] ?? P.log;
  return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter" stroke-linecap="square" aria-hidden="true"><path d="${d}"/></svg>`;
}
