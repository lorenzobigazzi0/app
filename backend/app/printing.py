from __future__ import annotations

from dataclasses import dataclass

@dataclass
class PrintResult:
    ok: bool
    error: str = ""

class PrintAdapter:
    async def print_text(self, connection: str, text: str) -> PrintResult:
        # Implementazioni reali possibili:
        # - CUPS: pycups
        # - ESC/POS: python-escpos
        # Qui: stub (segna come inviato).
        return PrintResult(ok=True)

adapter = PrintAdapter()
