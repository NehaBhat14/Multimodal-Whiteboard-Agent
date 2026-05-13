"""Simple capped LRU for tool result cache."""

from __future__ import annotations

from collections import OrderedDict
from typing import TypeVar

T = TypeVar("T")

_MAX = 64


def make_lru() -> "OrderedDict[tuple[str, str], T]":
    return OrderedDict()  # type: ignore[return-value]


def lru_get(cache: OrderedDict[tuple[str, str], T], key: tuple[str, str]) -> T | None:
    v = cache.get(key)
    if v is not None:
        cache.move_to_end(key)
    return v


def lru_set(
    cache: OrderedDict[tuple[str, str], T], key: tuple[str, str], value: T
) -> None:
    if key in cache:
        del cache[key]
    cache[key] = value
    if len(cache) > _MAX:
        cache.popitem(last=False)
