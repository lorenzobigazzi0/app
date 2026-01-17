import json
from collections import defaultdict
from typing import Any, Dict, Set

from fastapi import WebSocket

class ConnectionManager:
	def __init__(self) -> None:
		self._by_channel: Dict[str, Set[WebSocket]] = defaultdict(set)

	async def connect(self, ws: WebSocket, channel: str) -> None:
		await ws.accept()
		self._by_channel[channel].add(ws)

	def disconnect(self, ws: WebSocket) -> None:
		for ch in list(self._by_channel.keys()):
			self._by_channel[ch].discard(ws)
			if not self._by_channel[ch]:
				del self._by_channel[ch]

	async def broadcast(self, channel: str, event: Dict[str, Any]) -> None:
		if channel not in self._by_channel:
			return
		data = json.dumps(event, ensure_ascii=False)
		dead: Set[WebSocket] = set()
		for ws in self._by_channel[channel]:
			try:
				await ws.send_text(data)
			except Exception:
				dead.add(ws)
		for ws in dead:
			self._by_channel[channel].discard(ws)

	async def broadcast_many(self, channels: list[str], event: Dict[str, Any]) -> None:
		for ch in channels:
			await self.broadcast(ch, event)

manager = ConnectionManager()
