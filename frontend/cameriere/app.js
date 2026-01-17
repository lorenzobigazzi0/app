/* app.js
 * WAITer Station • Mobile
 * - Login (username/password) con demo utenti
 * - Drawer hamburger + routing: Dashboard / Listino / Tavoli / Sessione (solo incasso)
 * - Tavoli: gestione tavoli del cameriere + (se incasso) vista tutti i tavoli attivi
 * - Dettaglio tavolo: meta (nome, coperti, apericena, note), storico ordini, totale conto
 * - Aggiunta articoli da listino con quantità
 * - Riscossione: contanti (tagli) / carta + calcolo resto + chiusura tavolo
 * - Forzatura: se tavolo occupato da altro cameriere -> conferma, chiusura con nota
 */

(() => {
	/* ----------------------------- Helpers ----------------------------- */
	const $ = (id) => document.getElementById(id);
	const qsa = (sel) => Array.from(document.querySelectorAll(sel));
	const pad2 = (n) => String(n).padStart(2, "0");

	function nowISO() {
		const d = new Date();
		return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
	}

	function eur(n) {
		const v = Number(n || 0);
		return v.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
	}

	function toast(msg) {
		const el = $("toast");
		el.textContent = msg;
		el.classList.add("show");
		clearTimeout(toast._t);
		toast._t = setTimeout(() => el.classList.remove("show"), 1700);
	}

	function safeTrim(s) { return String(s ?? "").trim(); }

	/* ----------------------------- API + Realtime ----------------------------- */
	const API = {
		base: "",
		token: localStorage.getItem("token_waiter") || "",
	};

	async function apiLogin(username, password){
		const r = await fetch(`${API.base}/api/auth/login`, {
			method: "POST",
			headers: {"Content-Type":"application/json"},
			body: JSON.stringify({username, password})
		});
		if(!r.ok) throw new Error("Login fallito");
		const j = await r.json();
		API.token = j.access_token;
		localStorage.setItem("token_waiter", API.token);
	}

	async function apiMe(){
		const r = await fetch(`${API.base}/api/me`, { headers: {"Authorization": `Bearer ${API.token}`} });
		if(!r.ok) throw new Error("/api/me fallito");
		return await r.json();
	}

	async function apiFetchMenu(){
		const r = await fetch(`${API.base}/api/menu`, { headers: {"Authorization": `Bearer ${API.token}`} });
		if(!r.ok) throw new Error("/api/menu fallito");
		const items = await r.json();
		// Rigenera MENU e MENU_MAP usando sku come id "locale"
		const byCat = new Map();
		items.forEach(it => {
			if(!byCat.has(it.category)) byCat.set(it.category, []);
			byCat.get(it.category).push({ id: it.sku, apiId: it.id, name: it.name, price: it.price });
		});
		MENU.length = 0;
		MENU_MAP.clear();
		for(const [cat, arr] of byCat.entries()){
			arr.sort((a,b)=> a.name.localeCompare(b.name));
			MENU.push({ category: cat, items: arr });
			arr.forEach(x => MENU_MAP.set(x.id, x));
		}
	}

	async function apiSendOrder(tableObj, selection){
		const items = [];
		selection.forEach(s => {
			const mi = MENU_MAP.get(s.menuId);
			if(!mi) return;
			items.push({ menu_item_id: mi.apiId, qty: Number(s.qty||0), note: null });
		});
		const payload = {
			table_number: Number(tableObj.tableNumber),
			covers: Number(tableObj.meta?.covers||0),
			apericena: Number(tableObj.meta?.aperi||0),
			note: safeTrim(tableObj.meta?.notes) || null,
			items,
		};
		const r = await fetch(`${API.base}/api/orders`, {
			method: "POST",
			headers: {
				"Content-Type":"application/json",
				"Authorization": `Bearer ${API.token}`
			},
			body: JSON.stringify(payload)
		});
		if(!r.ok) throw new Error("Invio comanda fallito");
		return await r.json();
	}

	let g_wsPingTimer = null;
	let g_wsReconnectTimer = null;

	async function apiAckCall(callId){
		const r = await fetch(`${API.base}/api/calls/${callId}/ack`, {
			method: "POST",
			headers: {"Authorization": `Bearer ${API.token}`}
		});
		if(!r.ok) throw new Error("ACK fallito");
		return await r.json();
	}

	function showCallModal(call){
		const el = $("callModal");
		const msgEl = $("callModalMsg");
		const btn = $("callAckBtn");

		const tableTxt = call.table_id ? `Tavolo ID: ${call.table_id}` : "";
		const orderTxt = call.order_id ? `Ordine ID: ${call.order_id}` : "";
		const custom = (call.message && String(call.message).trim()) ? String(call.message).trim() : "Chiamata ricevuta";
		msgEl.textContent = [custom, tableTxt, orderTxt].filter(Boolean).join(" • ");

		el.style.display = "flex";
		btn.onclick = async ()=>{
			try{
				if(call.id) await apiAckCall(call.id);
			}catch(e){
				console.warn(e);
			}
			el.style.display = "none";
		};
		// vibrazione se supportata
		try{ if(navigator.vibrate) navigator.vibrate([120, 80, 120]); }catch(_){ }
	}

	function wsConnect(){
		if(!API.token) return;
		try{ if(g_ws) g_ws.close(); }catch(e){}
		if(g_wsPingTimer){ clearInterval(g_wsPingTimer); g_wsPingTimer = null; }
		if(g_wsReconnectTimer){ clearTimeout(g_wsReconnectTimer); g_wsReconnectTimer = null; }

		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		const url = `${proto}://${location.host}/ws?channel=waiter&token=${encodeURIComponent(API.token)}`;
		g_ws = new WebSocket(url);

		g_ws.onopen = () => {
			console.log("WS ok");
			g_wsPingTimer = setInterval(()=>{ try{ g_ws && g_ws.readyState===1 && g_ws.send("ping"); }catch(e){} }, 25000);
		};
		g_ws.onclose = () => {
			console.log("WS closed");
			if(g_wsPingTimer){ clearInterval(g_wsPingTimer); g_wsPingTimer = null; }
			g_wsReconnectTimer = setTimeout(wsConnect, 2000);
		};
		g_ws.onmessage = (ev)=>{
			let msg;
			try{ msg = JSON.parse(ev.data); }catch(e){ return; }
			if(msg.type === "call_created" || msg.event === "call.created"){
				toast("Chiamata dal BAR");
				if(msg.call) showCallModal(msg.call);
			}
		};
	}

	/* ----------------------------- Demo Users ----------------------------- */
	// enabledCash = true => vede incassi + tutti i tavoli attivi + menu Sessione
	const USERS = [
		{ username: "emma",  password: "1234", display: "Emma",  role: "Cameriere", enabledCash: false },
		{ username: "luca",  password: "1234", display: "Luca",  role: "Cameriere", enabledCash: false },
		{ username: "marco", password: "1234", display: "Marco", role: "Cameriere • Incasso", enabledCash: true },
	];

	/* ----------------------------- Listino (Demo) ----------------------------- */
	const MENU = [
		{
			category: "Drink",
			items: [
				{ id: "spritz", name: "Spritz", price: 6.00 },
				{ id: "gin_tonic", name: "Gin Tonic", price: 8.00 },
				{ id: "negroni", name: "Negroni", price: 9.00 },
				{ id: "analcolico", name: "Analcolico", price: 5.00 },
			],
		},
		{
			category: "Caffetteria",
			items: [
				{ id: "caffe", name: "Caffè", price: 1.20 },
				{ id: "cappuccino", name: "Cappuccino", price: 1.80 },
				{ id: "cornetto", name: "Cornetto", price: 1.50 },
			],
		},
		{
			category: "Apericena",
			items: [
				{ id: "tagliere", name: "Tagliere", price: 12.00 },
				{ id: "nachos", name: "Nachos", price: 7.50 },
				{ id: "patatine", name: "Patatine", price: 4.00 },
			],
		},
	];

	const MENU_MAP = new Map();
	MENU.forEach(c => c.items.forEach(i => MENU_MAP.set(i.id, i)));

	function countMenuItems() {
		let c = 0;
		MENU.forEach(x => c += x.items.length);
		return c;
	}

	/* ----------------------------- Data Model ----------------------------- */
	// Table structure:
	// {
	//   id, tableNumber, customName, ownerUsername, openedAt, closedAt,
	//   isOpen, forcedClosedBy, forcedCloseNote,
	//   meta: { name, covers, aperi, notes },
	//   orders: [ { id, createdAt, items: [{menuId, name, price, qty}], note, total } ],
	//   payments: [ { paidAt, method: "cash"|"card", total, received, change, cashierUsername } ],
	// }
	let g_tables = [];
	let g_session = {
		// payments across session (for cash-enabled users)
		payments: [],
	};
	let g_ws = null;

	// Demo: due tavoli già aperti
	g_tables.push(makeNewTable({
		tableNumber: 7,
		customName: "",
		ownerUsername: "emma",
		meta: { name: "Compleanno Anna", covers: 4, aperi: 2, notes: "" },
		seedOrder: [
			{ menuId: "gin_tonic", qty: 2 },
			{ menuId: "analcolico", qty: 1 },
		],
	}));

	g_tables.push(makeNewTable({
		tableNumber: 5,
		customName: "",
		ownerUsername: "luca",
		meta: { name: "", covers: 5, aperi: 2, notes: "1 Celiaco" },
		seedOrder: [
			{ menuId: "spritz", qty: 2 },
			{ menuId: "tagliere", qty: 1 },
		],
	}));

	function uid(prefix = "id") {
		return `${prefix}_${Math.random().toString(16).slice(2, 10)}_${Date.now().toString(16)}`;
	}

	function computeOrderTotal(order) {
		return order.items.reduce((sum, it) => sum + (Number(it.price) * Number(it.qty || 0)), 0);
	}

	function computeTableTotal(table) {
		const sumOrders = (table.orders || []).reduce((sum, o) => sum + Number(o.total || 0), 0);
		return sumOrders;
	}

	function isTableOpen(table) { return !!table && table.isOpen === true; }

	function makeNewTable({ tableNumber, customName, ownerUsername, meta, seedOrder }) {
		const t = {
			id: uid("tbl"),
			tableNumber: Number(tableNumber),
			customName: safeTrim(customName),
			ownerUsername: ownerUsername,
			openedAt: Date.now(),
			closedAt: null,
			isOpen: true,

			forcedClosedBy: null,
			forcedCloseNote: "",

			meta: {
				name: safeTrim(meta?.name),
				covers: Number(meta?.covers || 0),
				aperi: Number(meta?.aperi || 0),
				notes: safeTrim(meta?.notes),
			},

			orders: [],
			payments: [],
		};

		if (Array.isArray(seedOrder) && seedOrder.length > 0) {
			const o = createOrderFromSelection(seedOrder, "");
			t.orders.push(o);
		}

		return t;
	}

	function createOrderFromSelection(selection, noteText) {
		// selection: [{menuId, qty}]
		const items = [];
		selection.forEach(s => {
			const mi = MENU_MAP.get(s.menuId);
			if (!mi) return;
			const qty = Number(s.qty || 0);
			if (qty <= 0) return;
			items.push({
				menuId: mi.id,
				name: mi.name,
				price: Number(mi.price),
				qty: qty,
			});
		});

		const order = {
			id: uid("ord"),
			createdAt: Date.now(),
			note: safeTrim(noteText),
			items: items,
			total: 0,
		};
		order.total = computeOrderTotal(order);
		return order;
	}

	/* ----------------------------- App State ----------------------------- */
	const state = {
		route: "dashboard",
		theme: "light",
		user: null, // {username, display, role, enabledCash}
		selectedTableId: null,

		// items modal temp selection
		tempSelection: new Map(), // menuId -> qty

		// cash modal temp
		cash: {
			tableId: null,
			method: "cash", // cash|card
			received: 0,
			denoms: new Map(), // value -> count
		},
	};

	/* ----------------------------- UI: Routing ----------------------------- */
	function setRoute(route) {
		state.route = route;

		// Drawer items active
		qsa(".drawer-item").forEach(x => x.classList.toggle("active", x.dataset.route === route));

		// Views
		const map = {
			dashboard: "viewDashboard",
			listino: "viewListino",
			tavoli: "viewTavoli",
			table: "viewTableDetail",
			sessione: "viewSessione",
		};

		Object.values(map).forEach(id => {
			const el = $(id);
			if (el) el.style.display = "none";
		});

		const targetId = map[route] || "viewDashboard";
		$(targetId).style.display = "block";

		// Topbar title/sub
		const titles = {
			dashboard: "Dashboard",
			listino: "Listino",
			tavoli: "Tavoli",
			table: "Tavolo",
			sessione: "Sessione",
		};

		$("topTitle").textContent = titles[route] || "Dashboard";

		if (state.user) {
			const sub = state.user.enabledCash ? `${state.user.display} • Incasso` : `${state.user.display}`;
			$("topSub").textContent = sub;
		} else {
			$("topSub").textContent = "—";
		}

		renderAll();
	}

	/* ----------------------------- UI: Drawer ----------------------------- */
	function openDrawer() {
		const b = $("drawerBackdrop");
		b.classList.add("show");
		b.setAttribute("aria-hidden", "false");
	}
	function closeDrawer() {
		const b = $("drawerBackdrop");
		b.classList.remove("show");
		b.setAttribute("aria-hidden", "true");
	}

	/* ----------------------------- Theme ----------------------------- */
	function applyTheme() {
		document.body.setAttribute("data-theme", state.theme);
		const icon = $("btnTheme").querySelector("i");
		if (icon) {
			icon.className = state.theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
		}
	}

	function toggleTheme() {
		state.theme = (state.theme === "dark") ? "light" : "dark";
		applyTheme();
		toast(state.theme === "dark" ? "Dark mode" : "Light mode");
	}

	/* ----------------------------- Login/Logout ----------------------------- */
	function setLoggedUser(u) {
		state.user = u;

		// drawer header
		$("userName").textContent = u.display;
		$("userRole").textContent = u.role;
		$("userAvatar").textContent = (u.display || "G").trim().slice(0, 1).toUpperCase();

		// show incasso widgets
		$("cardRevenue").style.display = u.enabledCash ? "block" : "none";
		$("panelCashier").style.display = u.enabledCash ? "block" : "none";
		$("panelAllActive").style.display = u.enabledCash ? "block" : "none";
		$("menuSessione").style.display = u.enabledCash ? "flex" : "none";

		// shell
		$("loginScreen").style.display = "none";
		$("appShell").style.display = "flex";

		// default route
		setRoute("dashboard");
	}

	function doLogout() {
		state.user = null;
		state.selectedTableId = null;
		$("loginUser").value = "";
		$("loginPass").value = "";
		$("appShell").style.display = "none";
		$("loginScreen").style.display = "flex";
		toast("Logout effettuato");
	}

	async function tryLogin() {
		const u = safeTrim($("loginUser").value).toLowerCase();
		const p = safeTrim($("loginPass").value);

		const found = USERS.find(x => x.username === u && x.password === p);
		if (!found) {
			toast("Credenziali non valide");
			return;
		}

		try{
			await apiLogin(found.username, p);
			await apiFetchMenu();
			wsConnect();
		}catch(e){
			console.warn(e);
			toast("Backend non raggiungibile (modalità demo)");
		}

		setLoggedUser({
			username: found.username,
			display: found.display,
			role: found.role,
			enabledCash: !!found.enabledCash,
		});
		toast(`Login: ${found.display}`);
	}

	/* ----------------------------- Table Selection / CRUD ----------------------------- */
	function getTableById(id) { return g_tables.find(t => t.id === id) || null; }

	function getOpenTables() { return g_tables.filter(t => isTableOpen(t)); }

	function getMyOpenTables() {
		if (!state.user) return [];
		return g_tables.filter(t => isTableOpen(t) && t.ownerUsername === state.user.username);
	}

	function getAllOpenTables() { return getOpenTables(); }

	function findOpenTableByNumber(tableNumber) {
		const n = Number(tableNumber);
		return g_tables.find(t => isTableOpen(t) && Number(t.tableNumber) === n) || null;
	}

	function openTableDetail(tableId) {
		state.selectedTableId = tableId;
		setRoute("table");
	}

	function ensureSelectedTableStillValid() {
		if (!state.selectedTableId) return;
		const t = getTableById(state.selectedTableId);
		if (!t || !isTableOpen(t)) state.selectedTableId = null;
	}

	function createOrOpenTable({ tableNumber, customName }) {
		if (!state.user) return;

		const n = Number(tableNumber);
		if (!Number.isFinite(n) || n <= 0) {
			toast("Inserisci un numero tavolo valido");
			return;
		}

		const existing = findOpenTableByNumber(n);

		// Tavolo libero -> crea e assegna al cameriere
		if (!existing) {
			const t = makeNewTable({
				tableNumber: n,
				customName: safeTrim(customName),
				ownerUsername: state.user.username,
				meta: { name: safeTrim(customName), covers: 0, aperi: 0, notes: "" },
				seedOrder: [],
			});
			g_tables.push(t);
			toast(`Tavolo ${n} aperto`);
			closeTableModal();
			openTableDetail(t.id);
			return;
		}

		// Tavolo già occupato
		const owner = existing.ownerUsername;
		if (owner === state.user.username) {
			toast("Tavolo già in gestione: apro dettaglio");
			closeTableModal();
			openTableDetail(existing.id);
			return;
		}

		// Forzatura richiesta
		const ownerName = (USERS.find(x => x.username === owner)?.display) || owner;
		const ok = window.confirm(`Il tavolo ${n} è già in gestione di ${ownerName}.\nVuoi forzare e liberare il tavolo? (Eventuale conto pendente verrà chiuso con nota)`);
		if (!ok) return;

		forceCloseTable(existing.id, state.user.username);
		// ora crea nuovo tavolo
		const t2 = makeNewTable({
			tableNumber: n,
			customName: safeTrim(customName),
			ownerUsername: state.user.username,
			meta: { name: safeTrim(customName), covers: 0, aperi: 0, notes: "" },
			seedOrder: [],
		});
		g_tables.push(t2);

		toast(`Tavolo ${n} forzato e riaperto`);
		closeTableModal();
		openTableDetail(t2.id);
	}

	function forceCloseTable(tableId, byUsername) {
		const t = getTableById(tableId);
		if (!t || !isTableOpen(t)) return;

		const byName = (USERS.find(x => x.username === byUsername)?.display) || byUsername;

		t.isOpen = false;
		t.closedAt = Date.now();
		t.forcedClosedBy = byUsername;
		t.forcedCloseNote = `CHIUSO CON FORZATURA DA ${byName}`;

		// Sposta in “chiusi”: qui rimane nello storico globale con flag
		// Nessun pagamento registrato perché è “forzatura”.

		// se era selezionato
		if (state.selectedTableId === tableId) {
			state.selectedTableId = null;
		}
	}

	/* ----------------------------- Orders: Add Items ----------------------------- */
	function openItemsModal() {
		if (!state.selectedTableId) return;
		state.tempSelection = new Map();
		renderItemsPicker();
		showModal("itemsModal");
	}

	function closeItemsModal() {
		hideModal("itemsModal");
		state.tempSelection = new Map();
	}

	function renderItemsPicker() {
		const wrap = $("itemsPicker");
		wrap.innerHTML = "";

		MENU.forEach(cat => {
			const box = document.createElement("div");
			box.className = "cat";
			box.innerHTML = `
				<div class="cat-head">
					<span>${cat.category}</span>
					<span class="pill">${cat.items.length}</span>
				</div>
				<div class="cat-body"></div>
			`;
			const body = box.querySelector(".cat-body");

			cat.items.forEach(item => {
				const row = document.createElement("div");
				row.className = "item-row";
				const qty = state.tempSelection.get(item.id) || 0;

				row.innerHTML = `
					<div class="item-left">
						<div class="item-name">${item.name}</div>
						<div class="item-price">${eur(item.price)}</div>
					</div>
					<div class="qty">
						<button class="qbtn" data-act="dec" aria-label="Meno">-</button>
						<div class="qval">${qty}</div>
						<button class="qbtn" data-act="inc" aria-label="Più">+</button>
					</div>
				`;

				const qval = row.querySelector(".qval");
				const [bDec, bInc] = row.querySelectorAll(".qbtn");

				bDec.addEventListener("click", (e) => {
					e.stopPropagation();
					const v = Math.max(0, (state.tempSelection.get(item.id) || 0) - 1);
					if (v === 0) state.tempSelection.delete(item.id);
					else state.tempSelection.set(item.id, v);
					qval.textContent = String(v);
				});

				bInc.addEventListener("click", (e) => {
					e.stopPropagation();
					const v = (state.tempSelection.get(item.id) || 0) + 1;
					state.tempSelection.set(item.id, v);
					qval.textContent = String(v);
				});

				body.appendChild(row);
			});

			wrap.appendChild(box);
		});
	}

	function confirmItemsIntoOrder() {
		const t = getTableById(state.selectedTableId);
		if (!t || !isTableOpen(t)) {
			toast("Tavolo non valido");
			closeItemsModal();
			return;
		}

		const selection = [];
		for (const [menuId, qty] of state.tempSelection.entries()) {
			selection.push({ menuId, qty });
		}

		if (selection.length <= 0) {
			toast("Nessun articolo selezionato");
			return;
		}

		const note = ""; // se vuoi, puoi aggiungere una nota per singolo ordine
		const order = createOrderFromSelection(selection, note);
		t.orders.push(order);

		// Realtime: invia la comanda al backend (BAR la riceverà in tempo reale).
		if (API.token) {
			apiSendOrder(t, selection)
				.then((res) => {
					toast(`Comanda inviata #${res.public_id}`);
				})
				.catch((e) => {
					console.warn(e);
					toast("Invio comanda fallito (demo locale)");
				});
		}

		toast("Ordine aggiunto");
		closeItemsModal();
		renderAll();
	}

	/* ----------------------------- Table Detail: Meta ----------------------------- */
	function saveTableMeta() {
		const t = getTableById(state.selectedTableId);
		if (!t || !isTableOpen(t)) return;

		// Solo il proprietario può modificare meta (in demo). Incasso può visualizzare, ma non editare.
		const canEdit = state.user && (t.ownerUsername === state.user.username);
		if (!canEdit) {
			toast("Non puoi modificare questo tavolo");
			return;
		}

		t.meta.name = safeTrim($("fName").value);
		t.meta.covers = Number($("fCovers").value || 0);
		t.meta.aperi = Number($("fAperi").value || 0);
		t.meta.notes = safeTrim($("fNotes").value);

		toast("Dati tavolo salvati");
		renderAll();
	}

	/* ----------------------------- Cashier ----------------------------- */
	const DENOMS = [0.10, 0.20, 0.50, 1, 2, 5, 10, 20, 50];

	function cashReset() {
		state.cash.received = 0;
		state.cash.denoms = new Map();
		updateCashTotalsUI();
		renderDenoms();
	}

	function openCashModal(tableId) {
		if (!state.user?.enabledCash) {
			toast("Non sei abilitato alla riscossione");
			return;
		}
		const t = getTableById(tableId);
		if (!t || !isTableOpen(t)) return;

		state.cash.tableId = tableId;
		state.cash.method = "cash";
		state.cash.received = 0;
		state.cash.denoms = new Map();

		$("cashTable").textContent = `Tavolo ${t.tableNumber}`;
		$("cashTotal").textContent = eur(computeTableTotal(t));

		setPayMethod("cash");
		renderDenoms();
		updateCashTotalsUI();

		showModal("cashModal");
	}

	function closeCashModal() {
		hideModal("cashModal");
		state.cash.tableId = null;
	}

	function setPayMethod(m) {
		state.cash.method = m === "card" ? "card" : "cash";

		$("payCash").classList.toggle("active", state.cash.method === "cash");
		$("payCard").classList.toggle("active", state.cash.method === "card");

		$("cashSection").style.display = (state.cash.method === "cash") ? "block" : "none";
		$("cardSection").style.display = (state.cash.method === "card") ? "block" : "none";
	}

	function renderDenoms() {
		const wrap = $("denoms");
		wrap.innerHTML = "";

		DENOMS.forEach(v => {
			const count = state.cash.denoms.get(v) || 0;
			const btn = document.createElement("button");
			btn.className = "denom";
			btn.type = "button";
			btn.innerHTML = `<span>${eur(v)}</span> <span class="small">x${count}</span>`;

			btn.addEventListener("click", () => {
				state.cash.denoms.set(v, count + 1);
				recomputeReceived();
				renderDenoms();
			});

			btn.addEventListener("contextmenu", (e) => {
				// long press alternative on mobile isn't consistent; right-click for desktop:
				e.preventDefault();
				const c = state.cash.denoms.get(v) || 0;
				if (c <= 0) return;
				if (c === 1) state.cash.denoms.delete(v);
				else state.cash.denoms.set(v, c - 1);
				recomputeReceived();
				renderDenoms();
			});

			wrap.appendChild(btn);
		});
	}

	function recomputeReceived() {
		let r = 0;
		for (const [v, c] of state.cash.denoms.entries()) {
			r += Number(v) * Number(c || 0);
		}
		state.cash.received = Math.round(r * 100) / 100;
		updateCashTotalsUI();
	}

	function updateCashTotalsUI() {
		const t = getTableById(state.cash.tableId);
		const total = t ? computeTableTotal(t) : 0;

		const received = state.cash.received;
		const change = Math.round((received - total) * 100) / 100;

		$("cashReceived").textContent = eur(received);
		$("cashChange").textContent = eur(change > 0 ? change : 0);
	}

	function confirmPayment() {
		if (!state.user?.enabledCash) return;

		const t = getTableById(state.cash.tableId);
		if (!t || !isTableOpen(t)) {
			toast("Tavolo non valido");
			closeCashModal();
			return;
		}

		const total = Math.round(computeTableTotal(t) * 100) / 100;

		if (state.cash.method === "cash") {
			const received = Math.round(Number(state.cash.received || 0) * 100) / 100;
			if (received < total) {
				toast("Importo ricevuto insufficiente");
				return;
			}
			const change = Math.round((received - total) * 100) / 100;

			registerPaymentAndClose(t, {
				method: "cash",
				total,
				received,
				change,
				cashierUsername: state.user.username,
			});

			toast(`Pagato contanti • Resto: ${eur(change)}`);
			closeCashModal();
			setRoute("tavoli");
			return;
		}

		// card
		registerPaymentAndClose(t, {
			method: "card",
			total,
			received: null,
			change: null,
			cashierUsername: state.user.username,
		});

		toast("Pagato con carta");
		closeCashModal();
		setRoute("tavoli");
	}

	function registerPaymentAndClose(table, pay) {
		const p = {
			id: uid("pay"),
			paidAt: Date.now(),
			method: pay.method,
			total: Number(pay.total || 0),
			received: pay.received != null ? Number(pay.received) : null,
			change: pay.change != null ? Number(pay.change) : null,
			cashierUsername: pay.cashierUsername,
		};

		table.payments.push(p);
		g_session.payments.push(p);

		table.isOpen = false;
		table.closedAt = Date.now();

		// se era selezionato
		if (state.selectedTableId === table.id) state.selectedTableId = null;
	}

	/* ----------------------------- Modals helpers ----------------------------- */
	function showModal(id) {
		const el = $(id);
		el.classList.add("show");
		el.setAttribute("aria-hidden", "false");
	}
	function hideModal(id) {
		const el = $(id);
		el.classList.remove("show");
		el.setAttribute("aria-hidden", "true");
	}

	function openTableModal() {
		$("newTableNum").value = "";
		$("newTableName").value = "";
		showModal("tableModal");
	}
	function closeTableModal() {
		hideModal("tableModal");
	}

	/* ----------------------------- Render: Dashboard ----------------------------- */
	function renderDashboard() {
		if (!state.user) return;

		const myOpen = getMyOpenTables();
		const myClosed = g_tables.filter(t => !isTableOpen(t) && t.ownerUsername === state.user.username).length;

		$("statActive").textContent = String(myOpen.length);
		$("statClosed").textContent = String(myClosed);

		if (state.user.enabledCash) {
			const revenue = g_session.payments.reduce((s, p) => s + Number(p.total || 0), 0);
			$("statRevenue").textContent = eur(revenue);
		}

		// mini list
		const wrap = $("dashActiveList");
		wrap.innerHTML = "";

		if (myOpen.length <= 0) {
			wrap.innerHTML = `<div class="panel-sub">Nessun tavolo attivo.</div>`;
			return;
		}

		myOpen
			.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))
			.slice(0, 6)
			.forEach(t => {
				const el = document.createElement("div");
				el.className = "mini-item";
				const title = `Tavolo ${t.tableNumber}`;
				const sub = t.meta?.name ? t.meta.name : (t.customName || "—");
				const total = computeTableTotal(t);

				el.innerHTML = `
					<div class="mini-left">
						<div class="mini-title">${title}</div>
						<div class="mini-sub">${sub}</div>
					</div>
					<div class="mini-right">${eur(total)}</div>
				`;
				el.addEventListener("click", () => openTableDetail(t.id));
				wrap.appendChild(el);
			});
	}

	/* ----------------------------- Render: Listino ----------------------------- */
	function renderListino() {
		$("pillListinoCount").textContent = `${countMenuItems()} articoli`;

		const wrap = $("listinoWrap");
		wrap.innerHTML = "";

		MENU.forEach(cat => {
			const box = document.createElement("div");
			box.className = "cat";
			box.innerHTML = `
				<div class="cat-head">
					<span>${cat.category}</span>
					<span class="pill">${cat.items.length}</span>
				</div>
				<div class="cat-body"></div>
			`;
			const body = box.querySelector(".cat-body");

			cat.items.forEach(item => {
				const row = document.createElement("div");
				row.className = "item-row";
				row.innerHTML = `
					<div class="item-left">
						<div class="item-name">${item.name}</div>
						<div class="item-price">${eur(item.price)}</div>
					</div>
					<div class="badge orange">${eur(item.price)}</div>
				`;
				body.appendChild(row);
			});

			wrap.appendChild(box);
		});
	}

	/* ----------------------------- Render: Tavoli ----------------------------- */
	function renderTavoli() {
		if (!state.user) return;

		// My tables open
		const myWrap = $("myTablesList");
		myWrap.innerHTML = "";

		const myOpen = getMyOpenTables().sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));

		if (myOpen.length <= 0) {
			myWrap.innerHTML = `<div class="panel-sub">Non hai tavoli aperti. Premi <b>+</b> per aprirne uno.</div>`;
		} else {
			myOpen.forEach(t => {
				myWrap.appendChild(renderTableCard(t, false));
			});
		}

		// All active (cashier)
		if (state.user.enabledCash) {
			const allWrap = $("allActiveList");
			allWrap.innerHTML = "";
			const allOpen = getAllOpenTables().sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
			if (allOpen.length <= 0) {
				allWrap.innerHTML = `<div class="panel-sub">Nessun tavolo attivo.</div>`;
			} else {
				allOpen.forEach(t => {
					allWrap.appendChild(renderTableCard(t, true));
				});
			}
		}
	}

	function renderTableCard(t, showOwner) {
		const el = document.createElement("div");
		el.className = "table-card";

		const ownerName = (USERS.find(x => x.username === t.ownerUsername)?.display) || t.ownerUsername;
		const name = t.meta?.name || t.customName || "";
		const subParts = [];
		if (showOwner) subParts.push(`Cam: ${ownerName}`);
		if (name) subParts.push(name);
		subParts.push(`Coperti: ${Number(t.meta?.covers || 0)} • Aperi: ${Number(t.meta?.aperi || 0)}`);
		const sub = subParts.join(" • ");

		const total = computeTableTotal(t);

		el.innerHTML = `
			<div class="table-left">
				<div class="table-title">Tavolo ${t.tableNumber}</div>
				<div class="table-sub">${sub}</div>
			</div>
			<div class="table-right">
				<div class="badge green">${eur(total)}</div>
			</div>
		`;

		el.addEventListener("click", () => {
			// cash-enabled user can open and (from detail) incassare
			openTableDetail(t.id);
		});

		return el;
	}

	/* ----------------------------- Render: Table Detail ----------------------------- */
	function renderTableDetail() {
		ensureSelectedTableStillValid();
		const t = getTableById(state.selectedTableId);
		if (!t) {
			setRoute("tavoli");
			return;
		}

		const ownerName = (USERS.find(x => x.username === t.ownerUsername)?.display) || t.ownerUsername;
		const canEdit = state.user && (t.ownerUsername === state.user.username);

		$("detailTitle").textContent = `Tavolo ${t.tableNumber}`;
		$("detailOwnerPill").textContent = `Cam: ${ownerName}`;

		$("fName").value = t.meta?.name || "";
		$("fCovers").value = String(Number(t.meta?.covers || 0));
		$("fAperi").value = String(Number(t.meta?.aperi || 0));
		$("fNotes").value = t.meta?.notes || "";

		// lock fields if not owner
		["fName", "fCovers", "fAperi", "fNotes"].forEach(id => {
			$(id).disabled = !canEdit;
		});
		$("btnSaveMeta").disabled = !canEdit;

		// add items only if owner (in demo)
		$("btnAddItems").disabled = !canEdit;

		// cashout button only if enabledCash (and table open)
		$("btnCashout").style.display = state.user?.enabledCash ? "flex" : "none";

		// history
		const h = $("orderHistory");
		h.innerHTML = "";

		if (!t.orders || t.orders.length <= 0) {
			h.innerHTML = `<div class="panel-sub">Nessun ordine ancora.</div>`;
		} else {
			[...t.orders]
				.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
				.forEach(o => {
					const itemLines = (o.items || [])
						.map(i => `${i.qty}× ${i.name}`)
						.join(" • ");

					const el = document.createElement("div");
					el.className = "hist-item";
					el.innerHTML = `
						<div class="hist-title">Ordine ${new Date(o.createdAt).toLocaleString("it-IT")}</div>
						<div class="hist-sub">${itemLines || "—"}</div>
						${o.note ? `<div class="hist-sub"><b>Note:</b> ${o.note}</div>` : ""}
						<div class="hist-total">${eur(o.total)}</div>
					`;
					h.appendChild(el);
				});
		}

		$("detailTotal").textContent = eur(computeTableTotal(t));
	}

	/* ----------------------------- Render: Sessione ----------------------------- */
	function renderSessione() {
		if (!state.user?.enabledCash) return;

		const total = g_session.payments.reduce((s, p) => s + Number(p.total || 0), 0);
		const totalCard = g_session.payments.filter(p => p.method === "card").reduce((s, p) => s + Number(p.total || 0), 0);
		const totalCash = g_session.payments.filter(p => p.method === "cash").reduce((s, p) => s + Number(p.total || 0), 0);

		$("sessTotal").textContent = eur(total);
		$("sessCard").textContent = eur(totalCard);
		$("sessCash").textContent = eur(totalCash);

		const list = $("paymentsList");
		list.innerHTML = "";

		if (g_session.payments.length <= 0) {
			list.innerHTML = `<div class="panel-sub">Nessun pagamento registrato.</div>`;
			return;
		}

		[...g_session.payments]
			.sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0))
			.forEach(p => {
				const cashierName = (USERS.find(x => x.username === p.cashierUsername)?.display) || p.cashierUsername;
				const methodLabel = p.method === "cash" ? "Contanti" : "Carta";
				const extra = (p.method === "cash")
					? `Ricevuto: ${eur(p.received)} • Resto: ${eur(p.change)}`
					: `Pagamento carta`;

				const el = document.createElement("div");
				el.className = "hist-item";
				el.innerHTML = `
					<div class="hist-title">${new Date(p.paidAt).toLocaleString("it-IT")} • ${methodLabel}</div>
					<div class="hist-sub">${extra}</div>
					<div class="hist-sub">Cassa: ${cashierName}</div>
					<div class="hist-total">${eur(p.total)}</div>
				`;
				list.appendChild(el);
			});
	}

	/* ----------------------------- Render All ----------------------------- */
	function renderAll() {
		if (!state.user) return;

		if (state.route === "dashboard") renderDashboard();
		if (state.route === "listino") renderListino();
		if (state.route === "tavoli") renderTavoli();
		if (state.route === "table") renderTableDetail();
		if (state.route === "sessione") renderSessione();
	}

	/* ----------------------------- Events wiring ----------------------------- */
	function wireEvents() {
		// login
		$("btnLogin").addEventListener("click", tryLogin);
		$("loginPass").addEventListener("keydown", (e) => {
			if (e.key === "Enter") tryLogin();
		});

		// topbar
		$("btnMenu").addEventListener("click", openDrawer);
		$("btnTheme").addEventListener("click", toggleTheme);

		// drawer close/backdrop
		$("btnCloseDrawer").addEventListener("click", closeDrawer);
		$("drawerBackdrop").addEventListener("click", (e) => {
			if (e.target.id === "drawerBackdrop") closeDrawer();
		});

		// drawer items
		qsa(".drawer-item").forEach(item => {
			item.addEventListener("click", () => {
				const r = item.dataset.route;
				closeDrawer();
				if (r === "sessione" && !state.user?.enabledCash) return;
				setRoute(r);
			});
		});

		// logout
		$("btnLogout").addEventListener("click", () => {
			closeDrawer();
			doLogout();
		});

		// dashboard quicks
		$("btnGoTavoli").addEventListener("click", () => setRoute("tavoli"));
		$("btnGoCashier").addEventListener("click", () => setRoute("tavoli"));

		// tavoli add
		$("btnAddTable").addEventListener("click", openTableModal);

		// table modal
		$("btnCloseTableModal").addEventListener("click", closeTableModal);
		$("tableModal").addEventListener("click", (e) => {
			if (e.target.id === "tableModal") closeTableModal();
		});
		$("btnCreateTable").addEventListener("click", () => {
			const num = $("newTableNum").value;
			const name = $("newTableName").value;
			createOrOpenTable({ tableNumber: num, customName: name });
		});

		// table detail
		$("btnBackToTavoli").addEventListener("click", () => setRoute("tavoli"));
		$("btnSaveMeta").addEventListener("click", saveTableMeta);
		$("btnAddItems").addEventListener("click", openItemsModal);
		$("btnCashout").addEventListener("click", () => {
			if (!state.selectedTableId) return;
			openCashModal(state.selectedTableId);
		});

		// items modal
		$("btnCloseItems").addEventListener("click", closeItemsModal);
		$("btnCancelItems").addEventListener("click", closeItemsModal);
		$("btnConfirmItems").addEventListener("click", confirmItemsIntoOrder);
		$("itemsModal").addEventListener("click", (e) => {
			if (e.target.id === "itemsModal") closeItemsModal();
		});

		// cash modal
		$("btnCloseCash").addEventListener("click", closeCashModal);
		$("cashModal").addEventListener("click", (e) => {
			if (e.target.id === "cashModal") closeCashModal();
		});

		$("payCash").addEventListener("click", () => setPayMethod("cash"));
		$("payCard").addEventListener("click", () => setPayMethod("card"));
		$("btnResetCash").addEventListener("click", cashReset);
		$("btnConfirmPayment").addEventListener("click", confirmPayment);
	}

	/* ----------------------------- Init ----------------------------- */
	function init() {
		// default theme
		state.theme = "light";
		applyTheme();

		// wire
		wireEvents();

		// Mobile UX: swipe left/right per cambiare sezione (Dashboard/Tavoli/Listino/Sessione)
		let sx = 0, sy = 0;
		const swipeRoutes = ["dashboard", "tavoli", "listino", "sessione"];
		const content = document.querySelector(".content");
		if(content){
			content.addEventListener("touchstart", (e)=>{
				if(!e.touches || !e.touches[0]) return;
				sx = e.touches[0].clientX;
				sy = e.touches[0].clientY;
			}, { passive: true });
			content.addEventListener("touchend", (e)=>{
				if(!e.changedTouches || !e.changedTouches[0]) return;
				const dx = e.changedTouches[0].clientX - sx;
				const dy = e.changedTouches[0].clientY - sy;
				if(Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy)) return;
				// se siamo nel dettaglio tavolo, non cambiamo route con swipe
				if(state.route === "table") return;
				const idx = swipeRoutes.indexOf(state.route);
				const cur = idx >= 0 ? idx : 0;
				const next = dx < 0 ? Math.min(cur+1, swipeRoutes.length-1) : Math.max(cur-1, 0);
				if(next !== cur) setRoute(swipeRoutes[next]);
			}, { passive: true });
		}

		// UX: tap anywhere outside inputs to close keyboard (mobile-ish)
		document.addEventListener("click", (e) => {
			const t = e.target;
			const isInput = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
			if (!isInput && document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA")) {
				document.activeElement.blur();
			}
		}, { passive: true });

		// show login
		$("loginScreen").style.display = "flex";
		$("appShell").style.display = "none";

		// prefill demo (optional): commenta se non vuoi
		$("loginUser").value = "emma";
		$("loginPass").value = "1234";

		// render listino count even before login (safe)
		$("pillListinoCount").textContent = `${countMenuItems()} articoli`;
	}

	init();
})();
