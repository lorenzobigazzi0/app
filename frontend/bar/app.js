const STATIONS = ["BAR PRINCIPALE", "COCKTAIL", "CAFFETTERIA", "BAR 2"];
const WAITERS = [
	{ id: "L", name: "Luca" },
	{ id: "E", name: "Emma" },
	{ id: "M", name: "Marco" }
];

let orders = [];

const state = {
	stationActive: true,
	stationName: STATIONS[0],
	darkMode: false,
	loggedIn: false,
	userName: "Guest",
	userRole: "Non autenticato",
	selectedOrderId: null
};

function $(id){ return document.getElementById(id); }
function pad2(n){ return String(n).padStart(2,'0'); }
function fmtMMSS(ms){
	const t = Math.max(0, Math.floor(ms/1000));
	const m = Math.floor(t/60);
	const s = t % 60;
	return `${pad2(m)}:${pad2(s)}`;
}
function toast(msg){
	const el = $("toast");
	el.textContent = msg;
	el.classList.add("show");
	clearTimeout(toast._t);
	toast._t = setTimeout(()=> el.classList.remove("show"), 1600);
}

/* ----------------------------- API + Realtime ----------------------------- */
const API = {
	base: "",
	token: localStorage.getItem("token_bar") || "",
};

async function apiLogin(username = "bar", password = "1234"){
	const r = await fetch(`${API.base}/api/auth/login`, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({username, password})
	});
	if(!r.ok) throw new Error("Login fallito");
	const j = await r.json();
	API.token = j.access_token;
	localStorage.setItem("token_bar", API.token);
}

async function apiFetchOrders(){
	const r = await fetch(`${API.base}/api/orders`, {
		headers: {"Authorization": `Bearer ${API.token}`}
	});
	if(!r.ok) throw new Error("Impossibile leggere ordini");
	const j = await r.json();
	orders = j.map(apiOrderToUi);
}

function apiOrderToUi(o){
	return {
		id: o.public_id,
		table: o.table_number,
		waiter: o.waiter_name,
		covers: o.covers,
		apericena: o.apericena,
		note: o.note || "",
		receivedAtMs: Date.parse(o.created_at),
		completedAtMs: o.ready_at ? Date.parse(o.ready_at) : null,
		items: (o.items || []).map(it => ({
			id: it.id,
			name: it.name,
			note: it.note || "",
			done: !!it.is_done,
			qty: it.qty || 1,
		}))
	};
}

async function apiSetItemDone(orderPublicId, itemId, isDone){
	const r = await fetch(`${API.base}/api/orders/${encodeURIComponent(orderPublicId)}/items/${itemId}`, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${API.token}`,
		},
		body: JSON.stringify({is_done: isDone})
	});
	if(!r.ok) throw new Error("Aggiornamento fallito");
	const j = await r.json();
	const ui = apiOrderToUi(j);
	const idx = orders.findIndex(x => x.id === ui.id);
	if(idx >= 0) orders[idx] = ui; else orders.unshift(ui);
}

async function apiPrint(orderPublicId){
	const r = await fetch(`${API.base}/api/orders/${encodeURIComponent(orderPublicId)}/print`, {
		method: "POST",
		headers: {"Authorization": `Bearer ${API.token}`}
	});
	if(!r.ok) throw new Error("Stampa fallita");
	return await r.json();
}

async function apiCallWaiter(orderPublicId){
	const r = await fetch(`${API.base}/api/calls`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${API.token}`
		},
		body: JSON.stringify({call_type:"CALL_WAITER", order_public_id: orderPublicId})
	});
	if(!r.ok) throw new Error("Chiamata fallita");
	return await r.json();
}

function wsConnect(){
	try{ if(window._ws) window._ws.close(); }catch(e){}
	const proto = location.protocol === 'https:' ? 'wss' : 'ws';
	const url = `${proto}://${location.host}/ws?channel=bar&token=${encodeURIComponent(API.token)}`;
	const ws = new WebSocket(url);
	window._ws = ws;
	ws.onopen = ()=>{
		$("systemText").textContent = "ONLINE";
		$("systemDot").style.animationPlayState = "running";
		ws.send("ping");
		setInterval(()=>{ try{ ws.send("ping"); }catch(e){} }, 25000);
	};
	ws.onclose = ()=>{
		$("systemText").textContent = "OFFLINE";
		$("systemDot").style.animationPlayState = "paused";
		setTimeout(wsConnect, 2000);
	};
	ws.onmessage = (ev)=>{
		let msg = null;
		try{ msg = JSON.parse(ev.data); }catch(e){ return; }
		if(msg.type === "order_created" || msg.type === "order_updated"){
			const ui = apiOrderToUi(msg.order);
			const idx = orders.findIndex(x=>x.id===ui.id);
			if(idx>=0) orders[idx]=ui; else orders.unshift(ui);
			ensureSelection();
			renderOrdersFull();
			renderDetail();
		}
		if(msg.type === "call_created") toast("Chiamata ricevuta");
		if(msg.type === "print_job"){
			if(msg.ok) toast("Stampa inviata");
			else toast(`Errore stampa: ${msg.error||'?'}`);
		}
	};
}

function wsConnect(){
	if(!API.token) return;
	if(g_ws) { try { g_ws.close(); } catch(_){} }
	const proto = (location.protocol === "https:") ? "wss" : "ws";
	const url = `${proto}://${location.host}/ws?channel=bar&token=${encodeURIComponent(API.token)}`;
	g_ws = new WebSocket(url);
	g_ws.onopen = ()=>{ $("systemText").textContent = "ONLINE"; };
	g_ws.onclose = ()=>{ $("systemText").textContent = "OFFLINE"; };
	g_ws.onmessage = (ev)=>{
		let msg = null;
		try { msg = JSON.parse(ev.data); } catch(_) { return; }
		if(msg.type === "order_created" || msg.type === "order_updated"){
			const ui = apiOrderToUi(msg.order);
			const idx = orders.findIndex(x => x.id === ui.id);
			if(idx >= 0) orders[idx] = ui; else orders.unshift(ui);
			ensureSelection();
			renderOrdersFull();
			renderDetail();
		}
		if(msg.type === "call_created") toast("Chiamata ricevuta");
		// keepalive expects client to ping
	};
}

let g_ws;

function computeStatus(order){
	const total = order.items.length;
	const doneCount = order.items.filter(i=>i.done).length;
	if(doneCount <= 0) return "new";
	if(doneCount < total) return "prep";
	return "done";
}
function statusLabel(st){
	if(st === "new") return "IN ATTESA";
	if(st === "prep") return "IN PREPARAZIONE";
	return "PRONTA";
}
function sortOrders(list){
	const rank = (st)=> st === "done" ? 1 : 0;
	return [...list].sort((a,b)=>{
		const sa = computeStatus(a), sb = computeStatus(b);
		const ra = rank(sa), rb = rank(sb);
		if(ra !== rb) return ra - rb;
		const wa = (sa === "done" ? (a.completedAtMs - a.receivedAtMs) : (Date.now() - a.receivedAtMs));
		const wb = (sb === "done" ? (b.completedAtMs - b.receivedAtMs) : (Date.now() - b.receivedAtMs));
		if(ra === 0) return wb - wa;
		return wa - wb;
	});
}
function getOrderById(id){ return orders.find(o=>o.id === id) || null; }
function ensureSelection(){
	if(state.selectedOrderId && getOrderById(state.selectedOrderId)) return;
	const first = sortOrders(orders)[0];
	state.selectedOrderId = first ? first.id : null;
}
function getOrderElapsedMs(order){
	const end = (order.completedAtMs != null) ? order.completedAtMs : Date.now();
	return end - order.receivedAtMs;
}

function renderTop(){
	$("stationValue").textContent = state.stationName;

	$("userNameText").textContent = state.loggedIn ? state.userName : "Guest";
	$("userRoleText").textContent = state.loggedIn ? state.userRole : "Non autenticato";

	const initials = state.loggedIn
		? (state.userName.trim().split(/\s+/).slice(0,2).map(p=>p[0]?.toUpperCase()||"").join(""))
		: "G";
	$("avatarCircle").textContent = initials || "G";

	$("systemText").textContent = state.stationActive ? "ONLINE" : "PAUSA";
	$("systemDot").style.animationPlayState = state.stationActive ? "running" : "paused";

	const st = $("stationToggle");
	if(st.checked !== state.stationActive) st.checked = state.stationActive;

	const dt = $("darkToggle");
	if(dt.checked !== state.darkMode) dt.checked = state.darkMode;

	document.body.setAttribute("data-theme", state.darkMode ? "dark" : "light");
}

function renderClock(){
	const now = new Date();
	const months = ["GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO","LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"];
	$("dateText").textContent = `${pad2(now.getDate())} ${months[now.getMonth()]} ${now.getFullYear()}`;
	$("timeText").textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

function applyPauseUI(){
	const overlay = $("pauseOverlay");
	overlay.style.display = state.stationActive ? "none" : "flex";
	overlay.setAttribute("aria-hidden", state.stationActive ? "true" : "false");
}

function updateSelectedCard(){
	document.querySelectorAll(".order-card").forEach(c=>{
		c.classList.toggle("selected", c.dataset.orderId === state.selectedOrderId);
	});
}

function updateOrdersTimersAndStatus(){
	const wrap = $("ordersSidebar");
	wrap.querySelectorAll(".order-card").forEach(card=>{
		const id = card.dataset.orderId;
		const o = getOrderById(id);
		if(!o) return;

		const st = computeStatus(o);
		const strip = card.querySelector(".status-strip");
		const badge = card.querySelector(".status-badge");
		const timerEl = card.querySelector(".timer");

		timerEl.textContent = fmtMMSS(getOrderElapsedMs(o));

		strip.classList.toggle("st-new", st==="new");
		strip.classList.toggle("st-prep", st==="prep");
		strip.classList.toggle("st-done", st==="done");

		badge.classList.toggle("bg-new", st==="new");
		badge.classList.toggle("bg-prep", st==="prep");
		badge.classList.toggle("bg-done", st==="done");
		badge.textContent = statusLabel(st);
	});
}

function renderOrdersFull(){
	const wrap = $("ordersSidebar");
	const prevScroll = wrap.scrollTop;

	wrap.innerHTML = "";
	const sorted = sortOrders(orders);

	sorted.forEach(o=>{
		const st = computeStatus(o);
		const stripClass = (st === "new") ? "st-new" : (st === "prep" ? "st-prep" : "st-done");
		const badgeClass = (st === "new") ? "bg-new" : (st === "prep" ? "bg-prep" : "bg-done");

		const card = document.createElement("div");
		card.className = "order-card" + (o.id === state.selectedOrderId ? " selected" : "");
		card.dataset.orderId = o.id;

		card.innerHTML = `
			<div class="status-strip ${stripClass}"></div>
			<div class="card-header"><span>TAVOLO: ${o.table}</span> <span>#${o.id}</span></div>
			<div class="card-body">
				<div>Cam: ${o.waiter}</div>
				<span class="status-badge ${badgeClass}">${statusLabel(st)}</span>
				<span class="timer">--:--</span>
				<div>Coperti: ${o.covers} | Apericena: ${o.apericena}</div>
			</div>
		`;

		card.addEventListener("click", ()=>{
			if(!state.stationActive){
				toast("Postazione in pausa");
				return;
			}
			state.selectedOrderId = o.id;
			updateSelectedCard();
			renderDetails();
		});

		wrap.appendChild(card);
	});

	wrap.scrollTop = prevScroll;
	updateOrdersTimersAndStatus();
}

function setActionsEnabled(canUse, canReady){
	$("btnCall").disabled = !canUse;
	$("btnPrint").disabled = !canUse;
	$("btnReady").disabled = !(canUse && canReady);
}

function renderDetails(){
	const o = getOrderById(state.selectedOrderId);
	if(!o){
		$("dTable").textContent = "—";
		$("dWaiter").textContent = "—";
		$("dOrder").textContent = "—";
		$("dTimer").textContent = "—";
		$("itemList").innerHTML = `<div style="color:var(--text-secondary); font-weight:850; padding:10px 0;">Seleziona una comanda a sinistra.</div>`;
		$("sCovers").textContent = "—";
		$("sAperi").textContent = "—";
		$("sItems").textContent = "—";
		$("sNotes").style.display = "none";
		setActionsEnabled(false, false);
		return;
	}

	const st = computeStatus(o);
	const isDone = (st === "done");
	const elapsed = getOrderElapsedMs(o);

	$("dTable").textContent = String(o.table);
	$("dWaiter").textContent = o.waiter;
	$("dOrder").textContent = `#${o.id}`;
	$("dTimer").textContent = fmtMMSS(elapsed);

	const list = $("itemList");
	list.innerHTML = "";

	o.items.forEach((it)=>{
		const row = document.createElement("div");
		row.className = "order-item";

		const disabled = (!state.stationActive) || isDone;

		const q = Number(it.qty || 1);
		const qBadge = (q > 1) ? `<span class="qty-badge">x${q}</span>` : "";
		row.innerHTML = `
			<label class="check-container" style="${disabled ? "opacity:.65; cursor:not-allowed;" : ""}">
				<input type="checkbox" ${it.done ? "checked" : ""} ${disabled ? "disabled" : ""}>
				<span class="checkmark"></span>
			</label>
			<div class="item-name">${qBadge}${it.name.toUpperCase()}</div>
			<div class="item-notes">${(it.note && it.note.trim()) ? it.note.toUpperCase() : "N/A"}</div>
		`;

		const cb = row.querySelector("input[type=checkbox]");
		cb.addEventListener("change", async ()=>{
			if(disabled){
				cb.checked = it.done;
				return;
			}
			try{
				await apiSetItemDone(o.id, it.id, cb.checked);
				toast("Aggiornato");
				renderOrdersFull();
				updateSelectedCard();
				renderDetails();
			}catch(e){
				console.warn(e);
				toast("Errore update");
				cb.checked = it.done;
			}
		});

		list.appendChild(row);
	});

	$("sCovers").textContent = String(o.covers);
	$("sAperi").textContent = String(o.apericena);
	const totalQty = (o.items || []).reduce((sum, it) => sum + Number(it.qty || 1), 0);
	$("sItems").textContent = String(totalQty);

	if(o.note && o.note.trim()){
		$("sNotesText").textContent = o.note.toUpperCase();
		$("sNotes").style.display = "block";
	}else{
		$("sNotes").style.display = "none";
	}

	setActionsEnabled(state.stationActive, !isDone);
	$("btnReady").style.display = isDone ? "none" : "flex";
}

/* UPDATED: lista verticale scrollabile (1 colonna) */
function renderWaiters(){
	const w = $("waiterButtons");
	w.innerHTML = "";
	WAITERS.forEach(x=>{
		const btn = document.createElement("div");
		btn.className = "waiter-circle";
		btn.innerHTML = `
			<div class="waiter-left">
				<div class="waiter-badge">${x.id}</div>
				<div class="waiter-name">${x.name}</div>
			</div>
			`;
		btn.addEventListener("click", ()=> toast(`Chiamo ${x.name}`));
		w.appendChild(btn);
	});
}

function printOrder(order){
	const st = computeStatus(order);
	const elapsed = getOrderElapsedMs(order);
	const lines = order.items.map(it => `${it.name} (${it.note || "N/A"})`).join("\n");
	const w = window.open("", "_blank");
	w.document.write(`<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas; padding:18px">
POSTAZIONE: ${state.stationName} 
TAVOLO: ${order.table}
CAMERIERE: ${order.waiter}
COMANDA: #${order.id}

${lines}

NOTE: ${order.note || "N/A"}
</pre>`);
	w.document.close();
	w.focus();
}

$("stationToggle").addEventListener("change", function(){
	state.stationActive = !!this.checked;
	toast(state.stationActive ? "Postazione attiva" : "Postazione in pausa");
	applyPauseUI();
	renderTop();
	renderDetails();
});

$("darkToggle").addEventListener("change", function(){
	state.darkMode = !!this.checked;
	toast(state.darkMode ? "Dark mode" : "Light mode");
	renderTop();
});

$("btnCall").addEventListener("click", async function(){
	const o = getOrderById(state.selectedOrderId);
	if(!o) return;
	try{
		await apiCallWaiter(o.id);
		toast(`Chiamata inviata: ${o.waiter}`);
	}catch(e){
		console.warn(e);
		toast("Errore chiamata");
	}
});

$("btnPrint").addEventListener("click", async function(){
	const o = getOrderById(state.selectedOrderId);
	if(!o) return;
	try{
		const j = await apiPrint(o.id);
		toast(j.ok ? "Stampato" : `Errore stampa: ${j.error||"?"}`);
	}catch(e){
		console.warn(e);
		toast("Errore stampa");
	}
});

$("btnReady").addEventListener("click", async function(){
	const o = getOrderById(state.selectedOrderId);
	if(!o) return;
	if(!state.stationActive){ toast("Postazione in pausa"); return; }
	try{
		for(const i of o.items){
			if(!i.done){
				await apiSetItemDone(o.id, i.id, true);
			}
		}
		toast(`Comanda #${o.id} completata`);
		renderOrdersFull();
		updateSelectedCard();
		renderDetails();
	}catch(e){
		console.warn(e);
		toast("Errore completamento");
	}
});

function openStationModal(){
	$("stationModal").classList.add("show");
	$("stationModal").setAttribute("aria-hidden", "false");
	$("stationSelect").value = state.stationName;
}
function closeStationModal(){
	$("stationModal").classList.remove("show");
	$("stationModal").setAttribute("aria-hidden", "true");
}
function applyStation(){
	state.stationName = $("stationSelect").value;
	toast(`Postazione: ${state.stationName}`);
	closeStationModal();
	renderTop();
}

function openUserModal(){
	$("userModal").classList.add("show");
	$("userModal").setAttribute("aria-hidden", "false");
	$("loginName").value = state.loggedIn ? state.userName : "";
	$("loginRole").value = state.loggedIn ? state.userRole : "";
}
function closeUserModal(){
	$("userModal").classList.remove("show");
	$("userModal").setAttribute("aria-hidden", "true");
}
function doLogin(){
	const name = $("loginName").value.trim();
	const role = $("loginRole").value.trim() || "Barista";
	if(!name){ toast("Inserisci un nome"); return; }
	state.loggedIn = true;
	state.userName = name;
	state.userRole = role;
	toast(`Login: ${name}`);
	closeUserModal();
	renderTop();
}
function doLogout(){
	state.loggedIn = false;
	state.userName = "Guest";
	state.userRole = "Non autenticato";
	toast("Logout effettuato");
	closeUserModal();
	renderTop();
}

$("stationModal").addEventListener("click", (e)=>{
	if(e.target.id === "stationModal") closeStationModal();
});
$("userModal").addEventListener("click", (e)=>{
	if(e.target.id === "userModal") closeUserModal();
});

(function initStations(){
	const sel = $("stationSelect");
	sel.innerHTML = "";
	STATIONS.forEach(s=>{
		const opt = document.createElement("option");
		opt.value = s;
		opt.textContent = s;
		sel.appendChild(opt);
	});
})();

window.openStationModal = openStationModal;
window.closeStationModal = closeStationModal;
window.applyStation = applyStation;
window.openUserModal = openUserModal;
window.closeUserModal = closeUserModal;
window.doLogin = doLogin;
window.doLogout = doLogout;

(function initSelection(){
	const sorted = sortOrders(orders);
	const firstNonDone = sorted.find(o => computeStatus(o) !== "done") || sorted[0];
	state.selectedOrderId = firstNonDone ? firstNonDone.id : null;
})();

function renderAll(){
	ensureSelection();
	renderTop();
	renderOrdersFull();
	renderDetails();
	renderWaiters();
	applyPauseUI();
}

// Bootstrap: login BAR, carica ordini e apre WS.
(async ()=>{
	try{
		if(!API.token){
			await apiLogin();
		}
		state.loggedIn = true;
		state.userName = "Bar";
		state.userRole = "Bar";
		await apiFetchOrders();
		wsConnect();
	}catch(e){
		console.warn(e);
		toast("Backend non raggiungibile (demo offline)");
	}
	renderAll();
	renderClock();
})();

setInterval(()=>{
	renderClock();
	updateOrdersTimersAndStatus();
	renderDetails();
}, 1000);
