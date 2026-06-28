"""Сервис-юзербот покупки коллекционных подарков (путь B).

User-аккаунт под MTProto (Pyrogram), НЕ бот: покупает подарок на Portals за TON и
передаёт получателю. Наружу — внутренний HTTP для Go-бэка (каталог + покупка).

Запускается из session-string в .env (USERBOT_SESSION). Без него стартует, но
эндпоинты покупки/каталога вернут 503 — как и Go-бэк без TON_HOT_WALLET_MNEMONIC.

⚠️ ВАЛИДИРУЕТСЯ НА ДЕ-РИСК-ПРОГОНЕ (нельзя проверить без живого session):
  1. Portals authData из session: portalsmp.update_auth логинит Pyrogram сам —
     headless на сервере он так не сработает; нужно отдать ему наш session-string
     или повторить webview-авторизацию @portals нашим клиентом. См. portals_auth().
  2. Оплата покупки: Portals списывает с ВНУТРЕННЕГО баланса (кошелёк пополняет
     баланс на Portals), а не напрямую с кошелька. Значит USERBOT_TON_MNEMONIC
     фандит баланс Portals (шаг пополнения уточняем на прогоне).
  3. Передача подарка получателю: MTProto payments.transferStarGift через raw-API
     Pyrogram + кулдаун next_transfer_date (мгновенно или в очередь). См. deliver().
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

API_ID = int(os.environ.get("USERBOT_API_ID", "0") or "0")
API_HASH = os.environ.get("USERBOT_API_HASH", "")
SESSION = os.environ.get("USERBOT_SESSION", "")
MARGIN = float(os.environ.get("GIFT_MARGIN", "0.15"))
PORT = int(os.environ.get("PORT", "8100"))

# Pyrogram-клиент и кэш Portals-токена живут на уровне модуля (один аккаунт).
_app_client = None
_portals_token = ""


def enabled() -> bool:
    """Сервис готов покупать, только когда есть все креды аккаунта."""
    return bool(API_ID and API_HASH and SESSION)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Поднимаем Pyrogram-клиент из session при старте (если он задан)."""
    global _app_client
    if enabled():
        from pyrogram import Client

        _app_client = Client(
            name="gift-buyer",
            api_id=API_ID,
            api_hash=API_HASH,
            session_string=SESSION,
            in_memory=True,
        )
        await _app_client.start()
    yield
    if _app_client is not None:
        await _app_client.stop()


app = FastAPI(title="gifts-userbot", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True, "enabled": enabled()}


async def portals_auth() -> str:
    """Возвращает (кэшируя) authData для Portals API.

    ⚠️ VALIDATE: portalsmp.update_auth(api_id, api_hash) делает СВОЙ Pyrogram-логин
    (интерактивный) — на сервере с готовым session так не выйдет. На де-риске решаем:
    либо патчим update_auth под наш session_string, либо повторяем webview-авторизацию
    @portals через _app_client (открыть webview бота → достать tma-токен). Токен живёт
    ~1–7 дней — кэшируем и рефрешим по 401.
    """
    global _portals_token
    if _portals_token:
        return _portals_token
    try:
        import asyncio

        from portalsmp import update_auth

        # TODO(de-risk): передать наш session, а не заставлять update_auth логиниться.
        _portals_token = await update_auth(api_id=API_ID, api_hash=API_HASH)
        return _portals_token
    except Exception as e:  # noqa: BLE001 — наружу отдаём понятную 503
        raise HTTPException(503, f"portals auth not ready: {e}")


@app.get("/listings")
async def listings(limit: int = 30, gift_name: str = "", max_price: float = 100000):
    """Каталог подарков с маркета: id, имя, цена в TON, картинка, владелец.

    Go-бэк проксирует это в Mini App и накидывает маржу на цену перед показом.
    """
    if not enabled():
        raise HTTPException(503, "userbot disabled (no session)")
    token = await portals_auth()
    from portalsmp import search

    raw = search(sort="price_asc", limit=limit, gift_name=gift_name, max_price=max_price, authData=token)
    out = []
    for g in raw or []:
        out.append(
            {
                "nft_id": g.get("id"),
                "owner_id": g.get("owner_id"),
                "name": g.get("name"),
                "price_ton": g.get("price"),  # строка TON с маркета (без маржи)
                "photo_url": g.get("photo_url"),
                "attributes": g.get("attributes"),
            }
        )
    return {"gifts": out, "margin": MARGIN}


class BuyRequest(BaseModel):
    nft_id: str
    owner_id: int
    price_ton: float  # цена с маркета (Go проверяет, что юзер заплатил >= price*(1+margin))
    to_user_id: int  # Telegram id получателя (кому дарим)
    ref: str  # ссылка нашей заявки (идемпотентность/логи)


@app.post("/buy-and-deliver")
async def buy_and_deliver(req: BuyRequest):
    """Покупает подарок на Portals и передаёт получателю.

    Возвращает:
      {status:"delivered", gift_msg_id:...}            — отдан сразу;
      {status:"pending", available_at:<unix>}          — куплен, но кулдаун на передачу;
      ошибка 4xx/5xx                                     — покупка/передача не прошла
                                                           (Go вернёт TON юзеру).
    """
    if not enabled():
        raise HTTPException(503, "userbot disabled (no session)")
    token = await portals_auth()

    from portalsmp import buy

    # 1) Покупка на аккаунт юзербота (списание с баланса Portals).
    # ⚠️ VALIDATE: точная форма ответа buy() и как ловить «цена уехала»/«нет средств».
    bought = buy(nft_id=req.nft_id, owner_id=req.owner_id, price=req.price_ton, authData=token)
    if not bought:
        raise HTTPException(502, "portals buy failed (price moved / insufficient Portals balance)")

    # 2) Передача получателю через MTProto.
    return await deliver(req.nft_id, req.to_user_id)


async def deliver(nft_id: str, to_user_id: int) -> dict:
    """Передаёт купленный подарок получателю (MTProto payments.transferStarGift).

    ⚠️ VALIDATE: точный raw-вызов и параметры (Pyrogram high-level метода может не
    быть — идём через _app_client.invoke(raw.functions.payments.TransferStarGift(...))).
    Кулдаун: у коллекционных есть next_transfer_date — если передача сейчас запрещена,
    возвращаем {status:"pending", available_at}, а Go-воркер дотранслирует позже.
    """
    # TODO(de-risk): реализовать реальный transfer + чтение next_transfer_date.
    raise HTTPException(
        501,
        "deliver() not implemented — реализуется на де-риск-прогоне (нужен живой session)",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT)
