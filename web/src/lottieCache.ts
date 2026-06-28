// Кэш РАЗОБРАННЫХ lottie-данных. Тяжёлые анимации (кубики покоя ~300KB) при открытии
// экрана грузятся файлом асинхронно → их сначала НЕТ, потом они «появляются»/мерцают.
// Префетчим JSON при старте, парсим и держим объект в памяти; экран кубиков берёт его
// как animationData и рендерит синхронно (без сети) → грань стоит сразу, как кнопки.
const cache = new Map<string, object>();
const inflight = new Set<string>();

// prefetchLottie грузит и парсит /lottie/<name>.json в кэш (идемпотентно). Зови на старте
// приложения для граней, которые должны появляться мгновенно.
export function prefetchLottie(name: string): void {
  if (cache.has(name) || inflight.has(name)) return;
  inflight.add(name);
  fetch(`/lottie/${name}.json`)
    .then((r) => r.json())
    .then((d) => { cache.set(name, d as object); })
    .catch(() => { /* не критично — упадёт на обычную загрузку по path */ })
    .finally(() => { inflight.delete(name); });
}

// getLottieData возвращает разобранные данные, если уже в кэше (иначе undefined → вызывающий
// грузит обычным path).
export function getLottieData(name: string): object | undefined {
  return cache.get(name);
}
