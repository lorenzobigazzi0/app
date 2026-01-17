from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# NOTE: per default usiamo una stampa "dummy" (log).
# Puoi attivare CUPS installando pycups e usando kind="cups".

@dataclass
class PrintResult:
	ok: bool
	error: Optional[str] = None

class PrinterAdapter:
	def send(self, connection: str, title: str, text: str) -> PrintResult:
		raise NotImplementedError

class DummyPrinter(PrinterAdapter):
	def send(self, connection: str, title: str, text: str) -> PrintResult:
		print("\n----- PRINT JOB (DUMMY) -----")
		print(f"TO: {connection}")
		print(f"TITLE: {title}")
		print(text)
		print("----- END PRINT JOB -----\n")
		return PrintResult(ok=True)

class CupsPrinter(PrinterAdapter):
	def __init__(self) -> None:
		try:
			import cups  # type: ignore
			self._cups = cups
		except Exception as e:
			self._cups = None
			self._err = str(e)

	def send(self, connection: str, title: str, text: str) -> PrintResult:
		if self._cups is None:
			return PrintResult(ok=False, error=f"pycups non disponibile: {getattr(self, '_err', 'unknown')}")
		try:
			conn = self._cups.Connection()
			# connection = nome coda CUPS
			# inviamo come raw text (CUPS puo' richiedere filtro). In caso reale: genera PDF o ESC/POS.
			import tempfile
			with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
				f.write(text)
				path = f.name
			conn.printFile(connection, path, title, {})
			return PrintResult(ok=True)
		except Exception as e:
			return PrintResult(ok=False, error=str(e))


class SocketPrinter(PrinterAdapter):
	"""Invio RAW su stampanti di rete (tipico: 9100 / JetDirect).

	connection supportati:
	- "192.168.1.50:9100"
	- "tcp://192.168.1.50:9100"

	NOTA: molte termiche accettano testo plain; per ESC/POS completo usa un generatore ESC/POS.
	"""

	def send(self, connection: str, title: str, text: str) -> PrintResult:
		try:
			import socket
			conn = (connection or "").strip()
			if conn.startswith("tcp://"):
				conn = conn[len("tcp://"):]
			if ":" not in conn:
				return PrintResult(ok=False, error="Formato connection non valido. Usa IP:PORT (es. 192.168.1.50:9100)")
			host, port_s = conn.rsplit(":", 1)
			port = int(port_s)
			payload = (text + "\n\n").encode("utf-8", errors="replace")
			with socket.create_connection((host, port), timeout=5) as s:
				s.sendall(payload)
			return PrintResult(ok=True)
		except Exception as e:
			return PrintResult(ok=False, error=str(e))


def get_adapter(kind: str) -> PrinterAdapter:
	k = (kind or "").lower()
	if k == "cups":
		return CupsPrinter()
	if k in ("socket", "tcp", "net"):
		return SocketPrinter()
	return DummyPrinter()
