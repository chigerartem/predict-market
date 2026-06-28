#!/usr/bin/env python3
"""Генератор Pyrogram session-string для аккаунта-покупателя подарков.

Запусти ЛОКАЛЬНО на своём ПК (НЕ на сервере!). api_id/api_hash берутся из .env
(если заполнены) — иначе спросит. Дальше интерактивный логин: номер телефона →
код из Telegram → 2FA-пароль (если включён). На выходе — строка сессии.

⚠️ Session-string = ПОЛНЫЙ доступ к аккаунту. Это секрет: никому не показывай, в чат
не вставляй. Положи его в .env на сервере как USERBOT_SESSION.

  pip install -r requirements.txt
  python gen_session.py
"""

import asyncio
import os

# Pyrogram 2.0.106 при импорте зовёт asyncio.get_event_loop(), а Python 3.14 уже не
# создаёт loop автоматически (RuntimeError: no current event loop) — создаём явно
# ДО импорта pyrogram.
try:
    asyncio.get_event_loop()
except RuntimeError:
    asyncio.set_event_loop(asyncio.new_event_loop())


def from_env(key: str) -> str:
    """Читает значение из окружения или из соседнего .env (без зависимостей)."""
    if os.environ.get(key):
        return os.environ[key].strip()
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip()
    return ""


api_id = from_env("USERBOT_API_ID") or input("api_id: ").strip()
api_hash = from_env("USERBOT_API_HASH") or input("api_hash: ").strip()

from pyrogram import Client  # импорт после ввода, чтобы ошибка установки была раньше

# In-memory сессия (на диск ничего не пишем) — логинимся и сразу экспортируем строку.
# in_memory=True вместо имени ":memory:" (иначе Pyrogram создаёт файл ":memory:.session",
# а двоеточие в имени файла на Windows запрещено).
with Client("gift-buyer", api_id=int(api_id), api_hash=api_hash, in_memory=True) as app:
    me = app.get_me()
    session = app.export_session_string()
    print(f"\nЗалогинен как: {me.first_name} (@{me.username}, id={me.id})")
    print("\n=== SESSION STRING — СЕКРЕТ, положи в .env как USERBOT_SESSION ===\n")
    print(session)
    print("\nНикому не показывай эту строку и не вставляй в чат.")
