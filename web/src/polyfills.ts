import { Buffer } from "buffer";

// @ton/core (строит cell с memo-комментом для TON-депозита) опирается на Node-овский
// Buffer. В браузерной сборке Vite Node-глобалей нет, поэтому ставим Buffer вручную.
// Этот модуль импортируется ПЕРВЫМ в main.tsx, чтобы выполниться до любого модуля,
// который тянет @ton/core (иначе @ton/core увидит Buffer === undefined на загрузке).
const g = globalThis as unknown as Record<string, unknown>;
if (!g.Buffer) g.Buffer = Buffer;
// Часть TON-зависимостей читает process.env.* без guard'а; в браузере process нет.
// Минимальный шим, чтобы не падало «process is not defined» (global маппится в vite.config).
if (!g.process) g.process = { env: {} };
