/** Eine Polylinie mit `marker-mid` und einem Marker aus Kreisen: der Kostenwert des Bereinigers (code-kit 0.58.0) wächst mit Punkten × Kreisen. 700 × 500 liegt bei rund 35 % der Grenze von 1 Mio., also über der Klickschwelle (250 000) und unter der Ablehnung. */
export const MID_COST_SVG = (() => {
  const pts = Array.from({ length: 700 }, (_, i) => `${i % 100},${(i * 7) % 100}`).join(" ");
  const dots = Array.from({ length: 500 }, (_, i) => `<circle cx="${i % 10}" cy="${Math.floor(i / 10) % 10}" r="0.2"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><marker id="m" markerWidth="10" markerHeight="10">${dots}</marker></defs><polyline points="${pts}" fill="none" stroke="black" marker-mid="url(#m)"/></svg>`;
})();
