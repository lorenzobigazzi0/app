# Cassa Realtime (backend + GUI)

## Avvio rapido (dev)

### 1) PostgreSQL

Puoi usare Docker:

```bash
cd cassa_realtime
docker compose up -d db
```

Oppure un PostgreSQL locale e imposti `DATABASE_URL`.

### 2) Backend

```bash
cd cassa_realtime/backend
python -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e .

export DATABASE_URL='postgresql+asyncpg://cassa:cassa@localhost:5432/cassa'
export JWT_SECRET='dev-secret'

uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload
```

Poi apri:
- Bar: `http://localhost:8010/bar/`
- Cameriere: `http://localhost:8010/cameriere/`
- Cassa: `http://localhost:8010/cassa/`
- Admin: `http://localhost:8010/admin/`

## Credenziali demo
- Camerieri: `emma/1234`, `luca/1234`
- Incasso: `marco/1234`
- Bar: `bar/1234`
- Admin: `admin/admin`

## Realtime
- Login -> ricevi JWT
- WebSocket: `ws://localhost:8010/ws?token=<JWT>`
- Eventi push: `ticket.created`, `ticket.updated`, `call.created`, `printjob.updated`

## Nota stampa
Il modulo `printing.py` è uno **stub**. Ti ho lasciato i punti per integrare:
- CUPS (pycups)
- ESC/POS (python-escpos)

