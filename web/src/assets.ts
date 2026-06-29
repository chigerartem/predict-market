// Prefix the Vite base so runtime asset paths resolve both at the site root (prod)
// and under a subpath (GitHub Pages demo at /predict-market/). import.meta.env.BASE_URL
// is inlined at build time and always ends with "/". Accepts paths with or without a
// leading slash: asset("/lottie/x.json") === asset("lottie/x.json").
export const asset = (p: string): string => import.meta.env.BASE_URL + p.replace(/^\/+/, "");
