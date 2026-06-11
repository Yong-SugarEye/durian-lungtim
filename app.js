"use strict";

/* ============================================================
   ทุเรียนลุงทิม rev.0
   เว็บไฟล์เดียว: ลงทะเบียน + จองทุเรียน + ดูรายการ
   เก็บข้อมูลในเครื่องด้วย localStorage + ส่งเข้า Google Sheet
   ============================================================ */

const KEY_USER = "lungtim_user_v1";
const KEY_BOOKINGS = "lungtim_bookings_v1";
const KEY_SHEET_URL = "lungtim_sheet_url";

/* ตั้งค่า Google Sheet:
   ใส่ Web app URL ตรงนี้ก็ได้ หรือเว้นว่างแล้วไปกดปุ่ม
   "⚙ ตั้งค่า Google Sheet" ในเว็บเพื่อวาง URL (เก็บในเครื่อง)  */
const CONFIG = {
  SHEET_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbwD5zJMcuWvmY89op2SvhFFvfL96zJ_0lxxJGHM6IFsvhKixHNs139FBbEY32vixNwfLQ/exec",
};

/* เบอร์ที่เป็นแอดมิน (เห็นออเดอร์ทุกคน) + กุญแจสำหรับดึงข้อมูล
   ต้องตรงกับ ADMIN_KEY ใน google-apps-script.gs */
const ADMIN_PHONES = ["0962414622"];
const ADMIN_KEY = "lungtim-admin-6924";
function isAdmin() {
  return !!state.user && ADMIN_PHONES.includes(state.user.phone);
}

const THAI_PROVINCES = [
  "กรุงเทพมหานคร","กระบี่","กาญจนบุรี","กาฬสินธุ์","กำแพงเพชร","ขอนแก่น","จันทบุรี","ฉะเชิงเทรา",
  "ชลบุรี","ชัยนาท","ชัยภูมิ","ชุมพร","เชียงราย","เชียงใหม่","ตรัง","ตราด","ตาก","นครนายก",
  "นครปฐม","นครพนม","นครราชสีมา","นครศรีธรรมราช","นครสวรรค์","นนทบุรี","นราธิวาส","น่าน",
  "บึงกาฬ","บุรีรัมย์","ปทุมธานี","ประจวบคีรีขันธ์","ปราจีนบุรี","ปัตตานี","พระนครศรีอยุธยา",
  "พะเยา","พังงา","พัทลุง","พิจิตร","พิษณุโลก","เพชรบุรี","เพชรบูรณ์","แพร่","ภูเก็ต","มหาสารคาม",
  "มุกดาหาร","แม่ฮ่องสอน","ยโสธร","ยะลา","ร้อยเอ็ด","ระนอง","ระยอง","ราชบุรี","ลพบุรี","ลำปาง",
  "ลำพูน","เลย","ศรีสะเกษ","สกลนคร","สงขลา","สตูล","สมุทรปราการ","สมุทรสงคราม","สมุทรสาคร",
  "สระแก้ว","สระบุรี","สิงห์บุรี","สุโขทัย","สุพรรณบุรี","สุราษฎร์ธานี","สุรินทร์","หนองคาย",
  "หนองบัวลำภู","อ่างทอง","อำนาจเจริญ","อุดรธานี","อุตรดิตถ์","อุทัยธานี","อุบลราชธานี"
];

const state = {
  user: null,        // { name, phone }
  bookings: [],      // []
  currentView: "home",
  editingId: null,   // รหัสรายการที่กำลังแก้ไข (null = จองใหม่)
};

/* ---------- helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function normalizePhone(v) {
  return String(v || "").replace(/\D/g, "").slice(0, 10);
}
function isValidPhone(v) {
  return /^0[689]\d{8}$/.test(normalizePhone(v));
}
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("th-TH", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  // เติม datalist จังหวัด
  const dl = $("#provinceList");
  THAI_PROVINCES.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    dl.appendChild(opt);
  });

  state.user = loadJSON(KEY_USER, null);
  state.bookings = loadJSON(KEY_BOOKINGS, []);

  bindEvents();
  applyAuthState();
  updateSheetStatus();
  renderHistory();
  switchView("home");
  syncPending(); // ส่งรายการที่ค้างขึ้นชีต (ถ้าเชื่อมไว้)
  loadPrice();   // ดึงราคา/กก. ล่าสุดจากชีต
});

/* ============================================================
   EVENT BINDING
   ============================================================ */
function bindEvents() {
  // ---- sidebar navigation ----
  $$(".side-item[data-view], [data-view]").forEach((btn) => {
    if (!btn.dataset.view) return;
    btn.addEventListener("click", () => {
      if (btn.dataset.needsLogin === "true" && !state.user) {
        toast("กรุณาลงทะเบียนก่อน");
        switchView("home");
        $("#regName")?.focus();
        return;
      }
      if (btn.dataset.view === "booking") startFreshBooking();
      switchView(btn.dataset.view);
      closeDrawer();
    });
  });

  // ---- mobile drawer ----
  $("#menuToggle").addEventListener("click", openDrawer);
  $("#sideScrim").addEventListener("click", closeDrawer);

  // ---- register ----
  $("#registerForm").addEventListener("submit", onRegister);
  $("#regPhone").addEventListener("input", (e) => {
    e.target.value = normalizePhone(e.target.value);
  });

  // ---- logout ----
  $("#logoutButton").addEventListener("click", onLogout);

  // ---- welcome card shortcuts ----
  $("#goBookingButton").addEventListener("click", () => { startFreshBooking(); switchView("booking"); });
  $("#goHistoryButton").addEventListener("click", () => switchView("history"));

  // ---- booking form ----
  $("#incBtn").addEventListener("click", () => stepQty(1));
  $("#decBtn").addEventListener("click", () => stepQty(-1));
  $("#quantity").addEventListener("input", sanitizeQty);
  $("#recvPhone").addEventListener("input", (e) => { e.target.value = normalizePhone(e.target.value); });
  $("#postcode").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 5); });
  $$('input[name="method"]').forEach((r) => r.addEventListener("change", toggleDeliveryBlock));
  $("#cancelBooking").addEventListener("click", () => { startFreshBooking(); switchView("home"); });
  $("#bookingForm").addEventListener("submit", onBookingSubmit);

  // ---- history export (ปุ่มถูกซ่อนจากลูกค้า อาจไม่มีในหน้า) ----
  $("#exportButton")?.addEventListener("click", exportCSV);

  // ---- google sheet settings (ปุ่มถูกซ่อนจากลูกค้า อาจไม่มีในหน้า) ----
  $("#sheetSettingsBtn")?.addEventListener("click", onSheetSettings);

  // ---- admin refresh ----
  $("#adminRefresh")?.addEventListener("click", renderAdmin);

  // ---- ราคา: แอดมินคลิกเพื่อแก้ ----
  $("#heroPrice")?.addEventListener("click", onEditPrice);
  $("#bookingPrice")?.addEventListener("click", onEditPrice);

  // ---- success modal ----
  $("#successDone").addEventListener("click", () => $("#successModal").classList.add("is-hidden"));
  $("#copyOrderButton").addEventListener("click", copyReceipt);
  $("#successModal").addEventListener("click", (e) => {
    if (e.target === $("#successModal")) $("#successModal").classList.add("is-hidden");
  });
}

/* ============================================================
   AUTH
   ============================================================ */
function onRegister(e) {
  e.preventDefault();
  const name = $("#regName").value.trim();
  const phone = normalizePhone($("#regPhone").value);
  const phoneErr = $("#regPhoneErr");

  if (!name) { $("#regName").focus(); return; }
  if (!isValidPhone(phone)) {
    phoneErr.classList.remove("is-hidden");
    $("#regPhone").classList.add("invalid");
    $("#regPhone").focus();
    return;
  }
  phoneErr.classList.add("is-hidden");
  $("#regPhone").classList.remove("invalid");

  state.user = { name, phone };
  saveJSON(KEY_USER, state.user);
  applyAuthState();
  renderHistory();
  toast(`ยินดีต้อนรับ คุณ${name}`);
  switchView("home");
}

function onLogout() {
  state.user = null;
  localStorage.removeItem(KEY_USER);
  applyAuthState();
  switchView("home");
  toast("ออกจากระบบแล้ว");
}

function applyAuthState() {
  const loggedIn = !!state.user;

  $("#loginState").textContent = loggedIn
    ? `สวัสดี, ${state.user.name}`
    : "ยังไม่ได้ลงทะเบียน";
  $("#logoutButton").classList.toggle("is-hidden", !loggedIn);

  $("#registerCard").classList.toggle("is-hidden", loggedIn);
  $("#welcomeCard").classList.toggle("is-hidden", !loggedIn);

  // sidebar items that need login
  $$('.side-item[data-needs-login="true"]').forEach((b) => { b.disabled = !loggedIn; });

  // เมนูแอดมิน: โผล่เฉพาะเบอร์ที่เป็นแอดมิน
  $("#adminNav").classList.toggle("is-hidden", !isAdmin());

  // ราคา: แอดมินเห็นว่าคลิกแก้ได้
  $$(".price-tag, .hero-price").forEach((el) => el.classList.toggle("editable", isAdmin()));

  if (loggedIn) {
    $("#welcomeName").textContent = `คุณ${state.user.name}`;
    $("#welcomePhone").textContent = `เบอร์ ${state.user.phone}`;
    // prefill booking receiver
    $("#recvName").value = $("#recvName").value || state.user.name;
    $("#recvPhone").value = $("#recvPhone").value || state.user.phone;
  } else {
    $("#regName").value = "";
    $("#regPhone").value = "";
  }
}

/* ============================================================
   VIEW SWITCHING
   ============================================================ */
function switchView(view) {
  state.currentView = view;
  $$(".view").forEach((v) => {
    const active = v.id === `view-${view}`;
    v.classList.toggle("is-active", active);
    v.hidden = !active;
  });
  $$(".side-item[data-view]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.view === view);
  });
  if (view === "booking") prepBookingForm();
  if (view === "history") renderHistory();
  if (view === "admin") renderAdmin();
  $("#content").scrollTo?.({ top: 0 });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openDrawer() {
  $("#sidePanel").classList.add("open");
  $("#sideScrim").hidden = false;
}
function closeDrawer() {
  $("#sidePanel").classList.remove("open");
  $("#sideScrim").hidden = true;
}

/* ============================================================
   BOOKING FORM
   ============================================================ */
function prepBookingForm() {
  if (state.user) {
    if (!$("#recvName").value) $("#recvName").value = state.user.name;
    if (!$("#recvPhone").value) $("#recvPhone").value = state.user.phone;
  }
  toggleDeliveryBlock();
}

function setSubmitLabel(editing) {
  const btn = $("#bookingSubmitBtn");
  if (btn) btn.textContent = editing ? "บันทึกการแก้ไข" : "ยืนยันการจอง";
}

function setRadio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

// ล็อก/ปลดล็อกการเลือกรอบจัดส่ง (ตอนแก้ไขห้ามเปลี่ยนรอบ)
function setRoundEnabled(enabled) {
  document.querySelectorAll('input[name="round"]').forEach((r) => { r.disabled = !enabled; });
  const grp = document.querySelector(".round-group");
  if (grp) grp.classList.toggle("is-locked", !enabled);
  const note = $("#roundLockNote");
  if (note) note.classList.toggle("is-hidden", enabled);
}

// เริ่มจองใหม่ (ล้างฟอร์ม + ออกจากโหมดแก้ไข)
function startFreshBooking() {
  state.editingId = null;
  const form = $("#bookingForm");
  if (form) {
    form.reset();
    $("#quantity").value = "1";
  }
  setRoundEnabled(true); // จองใหม่ -> เลือกรอบได้
  setSubmitLabel(false);
}

// โหลดรายการเดิมขึ้นมาแก้ไข
function editBooking(id) {
  const b = state.bookings.find((x) => x.id === id);
  if (!b) return;
  state.editingId = id;
  switchView("booking");
  setRadio("round", b.round || "รอบที่ 1 : 8 มิถุนายน 2569");
  setRoundEnabled(false); // แก้ไข -> ล็อกรอบ เปลี่ยนไม่ได้
  setRadio("method", b.method || "จัดส่ง");
  $("#quantity").value = b.quantity || 1;
  $("#recvName").value = b.recvName || "";
  $("#recvPhone").value = b.recvPhone || "";
  $("#addrLine").value = b.addrLine || "";
  $("#tambon").value = b.tambon || "";
  $("#amphoe").value = b.amphoe || "";
  $("#province").value = b.province || "";
  $("#postcode").value = b.postcode || "";
  $("#note").value = b.note || "";
  toggleDeliveryBlock();
  setSubmitLabel(true);
  toast("กำลังแก้ไขรายการ " + id);
}

function stepQty(amount) {
  const cur = Number($("#quantity").value) || 1;
  $("#quantity").value = String(Math.min(99, Math.max(1, cur + amount)));
}
function sanitizeQty() {
  const v = Number($("#quantity").value);
  if (!Number.isFinite(v) || v < 1) $("#quantity").value = "1";
  else if (v > 99) $("#quantity").value = "99";
}

function currentMethod() {
  return document.querySelector('input[name="method"]:checked').value;
}

function toggleDeliveryBlock() {
  const isDelivery = currentMethod() === "จัดส่ง";
  const block = $("#deliveryBlock");
  block.classList.toggle("is-hidden", !isDelivery);
  // ฟิลด์ที่อยู่จำเป็นเฉพาะกรณีจัดส่ง
  ["recvName", "recvPhone", "addrLine", "tambon", "amphoe", "province", "postcode"].forEach((id) => {
    $("#" + id).required = isDelivery;
  });
}

function onBookingSubmit(e) {
  e.preventDefault();
  const errBox = $("#bookingErr");
  errBox.classList.add("is-hidden");

  if (!state.user) { toast("กรุณาลงทะเบียนก่อน"); switchView("home"); return; }

  const isDelivery = currentMethod() === "จัดส่ง";
  const roundEl = document.querySelector('input[name="round"]:checked');
  const fields = {
    quantity: Number($("#quantity").value) || 1,
    round: roundEl ? roundEl.value : "",
    method: currentMethod(),
    recvName: $("#recvName").value.trim(),
    recvPhone: normalizePhone($("#recvPhone").value),
    addrLine: $("#addrLine").value.trim(),
    tambon: $("#tambon").value.trim(),
    amphoe: $("#amphoe").value.trim(),
    province: $("#province").value.trim(),
    postcode: $("#postcode").value.trim(),
    note: $("#note").value.trim(),
  };

  // validation
  let firstInvalid = null;
  const requireList = isDelivery
    ? ["recvName", "recvPhone", "addrLine", "tambon", "amphoe", "province", "postcode"]
    : [];
  requireList.forEach((id) => {
    const el = $("#" + id);
    const empty = !el.value.trim();
    el.classList.toggle("invalid", empty);
    if (empty && !firstInvalid) firstInvalid = el;
  });
  if (isDelivery && fields.recvPhone && !isValidPhone(fields.recvPhone)) {
    $("#recvPhone").classList.add("invalid");
    if (!firstInvalid) firstInvalid = $("#recvPhone");
  }
  if (isDelivery && fields.postcode && !/^\d{5}$/.test(fields.postcode)) {
    $("#postcode").classList.add("invalid");
    if (!firstInvalid) firstInvalid = $("#postcode");
  }
  if (firstInvalid) {
    errBox.classList.remove("is-hidden");
    firstInvalid.focus();
    return;
  }

  // โหมดแก้ไข: อัปเดตรายการเดิม (รหัส/เวลาเดิม) แล้วส่งทับแถวเดิมในชีต
  if (state.editingId) {
    const idx = state.bookings.findIndex((b) => b.id === state.editingId);
    if (idx >= 0) {
      const updated = { ...state.bookings[idx], ...fields, synced: false, editedAt: new Date().toISOString() };
      state.bookings[idx] = updated;
      saveJSON(KEY_BOOKINGS, state.bookings);
      renderHistory();
      startFreshBooking();
      showSuccess(updated, true);
      syncBooking(updated);
      return;
    }
    startFreshBooking();
  }

  const booking = {
    id: "BK" + Date.now().toString(36).toUpperCase(),
    user: state.user.name,
    userPhone: state.user.phone,
    createdAt: new Date().toISOString(),
    synced: false,
    ...fields,
  };

  state.bookings.unshift(booking);
  saveJSON(KEY_BOOKINGS, state.bookings);
  renderHistory();
  $("#bookingForm").reset();
  $("#quantity").value = "1";
  showSuccess(booking);
  syncBooking(booking); // ส่งเข้า Google Sheet (ถ้าตั้งค่าไว้)
}

/* ============================================================
   GOOGLE SHEET SYNC
   ส่งข้อมูลเข้า Google Sheet ผ่าน Apps Script Web App
   ใช้ mode:"no-cors" จึงอ่านผลลัพธ์ตรง ๆ ไม่ได้ แต่ข้อมูลถูกบันทึก
   ถ้า fetch ไม่ error (ส่งถึงปลายทาง) ถือว่าส่งสำเร็จ
   ============================================================ */
function getSheetUrl() {
  const saved = (localStorage.getItem(KEY_SHEET_URL) || "").trim();
  return saved || CONFIG.SHEET_WEBAPP_URL || "";
}

function setSheetUrl(url) {
  const clean = (url || "").trim();
  if (clean) localStorage.setItem(KEY_SHEET_URL, clean);
  else localStorage.removeItem(KEY_SHEET_URL);
  updateSheetStatus();
}

function isSheetConfigured() {
  return /^https:\/\/script\.google\.com\/.+\/exec$/.test(getSheetUrl());
}

async function syncBooking(b) {
  const url = getSheetUrl();
  if (!url) return; // ยังไม่ได้ตั้งค่า -> เก็บในเครื่องอย่างเดียว
  try {
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(b),
    });
    b.synced = true;
  } catch (err) {
    b.synced = false;
    console.warn("ส่งเข้า Google Sheet ไม่สำเร็จ:", err);
  }
  saveJSON(KEY_BOOKINGS, state.bookings);
  renderHistory();
}

// ส่งซ้ำรายการที่ยังไม่ได้ขึ้นชีต (เรียกตอนเปิดหน้า/หลังตั้งค่า URL)
async function syncPending() {
  if (!getSheetUrl()) return;
  const pending = state.bookings.filter((b) => !b.synced);
  for (const b of pending) {
    await syncBooking(b);
  }
}

/* ---------- ราคา/กก. (เก็บส่วนกลางในชีต แอดมินแก้ได้) ---------- */
function applyPrice(price) {
  const v = String(price || "").replace(/[^\d.]/g, "") || "100";
  document.querySelectorAll(".price-value").forEach((el) => { el.textContent = v; });
}

async function loadPrice() {
  if (!getSheetUrl()) return;
  try {
    const data = await jsonp({});
    if (data && data.pricePerKg) applyPrice(data.pricePerKg);
  } catch (e) { /* ใช้ค่าที่แสดงอยู่เดิม */ }
}

async function onEditPrice() {
  if (!isAdmin()) return; // เฉพาะแอดมิน
  const cur = (document.querySelector(".price-value") || {}).textContent || "100";
  const input = window.prompt("ตั้งราคาต่อกิโลกรัม (บาท)", cur);
  if (input === null) return;
  const price = String(input).replace(/[^\d.]/g, "");
  if (!price) { toast("กรุณาใส่ตัวเลขราคา"); return; }
  applyPrice(price); // อัปเดตทันทีในจอ
  const url = getSheetUrl();
  if (url) {
    try {
      await fetch(url, {
        method: "POST", mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "setprice", key: ADMIN_KEY, price }),
      });
      toast("ตั้งราคา " + price + " บาท/กก. แล้ว");
    } catch (e) { toast("บันทึกราคาไม่สำเร็จ ลองใหม่"); }
  }
}

function updateSheetStatus() {
  const el = $("#sheetStatus");
  const btn = $("#sheetSettingsBtn");
  if (!el) return;
  if (isSheetConfigured()) {
    el.textContent = "● เชื่อม Google Sheet แล้ว";
    el.className = "sheet-status ok";
    if (btn) btn.textContent = "⚙ แก้ไขลิงก์ Google Sheet";
  } else if (getSheetUrl()) {
    el.textContent = "● ลิงก์ไม่ถูกต้อง (ต้องลงท้าย /exec)";
    el.className = "sheet-status warn";
  } else {
    el.textContent = "○ ยังไม่เชื่อม Google Sheet";
    el.className = "sheet-status";
    if (btn) btn.textContent = "⚙ ตั้งค่า Google Sheet";
  }
}

function onSheetSettings() {
  const current = getSheetUrl();
  const url = window.prompt(
    "วาง Web app URL ของ Google Apps Script\n(ลงท้ายด้วย /exec)\n\nเว้นว่างแล้วกดตกลง = ยกเลิกการเชื่อม",
    current
  );
  if (url === null) return; // กดยกเลิก
  setSheetUrl(url);
  if (url.trim() && !isSheetConfigured()) {
    toast("ลิงก์อาจไม่ถูกต้อง ตรวจว่าลงท้าย /exec");
  } else if (url.trim()) {
    toast("เชื่อม Google Sheet แล้ว กำลังซิงค์รายการค้าง…");
    syncPending();
  } else {
    toast("ยกเลิกการเชื่อม Google Sheet");
  }
}

/* ============================================================
   SUCCESS MODAL + RECEIPT
   ============================================================ */
function receiptText(b) {
  const lines = [
    "🟢 จองทุเรียนลุงทิม",
    `รหัส: ${b.id}`,
    `ผู้จอง: ${b.user} (${b.userPhone})`,
    `จำนวน: ${b.quantity} ลูก`,
    `รอบตัด/จัดส่ง: ${b.round || "-"}`,
    `วิธีรับ: ${b.method}`,
  ];
  if (b.method === "จัดส่ง") {
    lines.push(
      `ผู้รับ: ${b.recvName} (${b.recvPhone})`,
      `ที่อยู่: ${b.addrLine} ต.${b.tambon} อ.${b.amphoe} จ.${b.province} ${b.postcode}`
    );
  }
  if (b.note) lines.push(`หมายเหตุ: ${b.note}`);
  lines.push(`เวลา: ${fmtDate(b.createdAt)}`);
  return lines.join("\n");
}

function showSuccess(b, isEdit) {
  const title = $("#successTitle");
  if (title) title.textContent = isEdit ? "บันทึกการแก้ไขแล้ว!" : "จองสำเร็จ!";
  $("#orderReceipt").textContent = receiptText(b);
  $("#successModal").classList.remove("is-hidden");
}

async function copyReceipt() {
  const text = $("#orderReceipt").textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast("คัดลอกแล้ว ส่งให้ทางสวนได้เลย");
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("คัดลอกแล้ว");
  }
}

/* ============================================================
   HISTORY
   ============================================================ */
function myBookings() {
  if (!state.user) return [];
  return state.bookings.filter((b) => b.userPhone === state.user.phone);
}

function renderHistory() {
  const list = $("#historyList");
  const empty = $("#historyEmpty");
  const items = myBookings();

  // badge ในแถบซ้าย
  const badge = $("#historyBadge");
  badge.textContent = String(items.length);
  badge.classList.toggle("is-hidden", items.length === 0);

  $("#historyCount").textContent = `${items.length} รายการ`;
  const exportBtn = $("#exportButton");
  if (exportBtn) exportBtn.disabled = items.length === 0;

  list.innerHTML = "";
  if (items.length === 0) {
    empty.classList.remove("is-hidden");
    return;
  }
  empty.classList.add("is-hidden");

  items.forEach((b) => {
    const el = document.createElement("article");
    el.className = "history-item";
    const addr = b.method === "จัดส่ง"
      ? `<p class="hi-detail"><strong>ผู้รับ:</strong> ${esc(b.recvName)} (${esc(b.recvPhone)})</p>
         <p class="hi-detail"><strong>ที่อยู่:</strong> ${esc(b.addrLine)} ต.${esc(b.tambon)} อ.${esc(b.amphoe)} จ.${esc(b.province)} ${esc(b.postcode)}</p>`
      : `<p class="hi-detail">รับที่โรงงาน</p>`;
    const note = b.note ? `<p class="hi-detail"><strong>หมายเหตุ:</strong> ${esc(b.note)}</p>` : "";
    const roundLine = b.round ? `<p class="hi-detail"><strong>รอบตัด/จัดส่ง:</strong> ${esc(b.round)}</p>` : "";

    // สถานะการส่งเข้า Google Sheet
    let sync = "";
    if (getSheetUrl()) {
      sync = b.synced
        ? `<span class="hi-sync ok">✓ บันทึกใน Google Sheet</span>`
        : `<span class="hi-sync warn">⏳ รอส่งขึ้น Sheet</span>`;
    }
    const resendBtn = (getSheetUrl() && !b.synced)
      ? `<button type="button" data-resend="${b.id}">↻ ส่งซ้ำ</button>` : "";

    el.innerHTML = `
      <div class="history-item-top">
        <span class="hi-qty">${b.quantity} ลูก</span>
        <span class="hi-method">${esc(b.method)}</span>
      </div>
      <p class="hi-date">${esc(b.id)} · ${fmtDate(b.createdAt)} ${sync}</p>
      ${roundLine}${addr}${note}
      <div class="hi-actions">
        <button type="button" data-edit="${b.id}">✏️ แก้ไข</button>
        <button type="button" data-copy="${b.id}">📋 คัดลอก</button>
        ${resendBtn}
      </div>`;
    list.appendChild(el);
  });

  // bind actions
  list.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const b = state.bookings.find((x) => x.id === btn.dataset.copy);
      if (b) { $("#orderReceipt").textContent = receiptText(b); copyReceipt(); }
    });
  });
  list.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => editBooking(btn.dataset.edit));
  });
  list.querySelectorAll("[data-resend]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const b = state.bookings.find((x) => x.id === btn.dataset.resend);
      if (b) { toast("กำลังส่งซ้ำ…"); syncBooking(b); }
    });
  });
}

function deleteBooking(id) {
  if (!confirm("ต้องการลบรายการนี้?")) return;
  state.bookings = state.bookings.filter((b) => b.id !== id);
  saveJSON(KEY_BOOKINGS, state.bookings);
  renderHistory();
  toast("ลบรายการแล้ว");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================================================
   ADMIN — ดูออเดอร์ทุกคน (ดึงจาก Google Sheet ผ่าน JSONP)
   ============================================================ */
// ดึงข้อมูลจาก Apps Script แบบ JSONP (เลี่ยง CORS)
function jsonp(params) {
  return new Promise((resolve, reject) => {
    const url = getSheetUrl();
    if (!url) { reject(new Error("ยังไม่ได้ตั้งค่า Google Sheet")); return; }
    const cb = "__jsonp_" + Date.now() + "_" + Math.floor(Math.random() * 1e4);
    const script = document.createElement("script");
    const timer = setTimeout(() => { cleanup(); reject(new Error("หมดเวลา")); }, 15000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    window[cb] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("โหลดไม่สำเร็จ")); };
    const qs = Object.keys(params || {})
      .map((k) => k + "=" + encodeURIComponent(params[k])).join("&");
    script.src = url + "?" + (qs ? qs + "&" : "") + "callback=" + cb + "&t=" + Date.now();
    document.body.appendChild(script);
  });
}

function loadAdminOrders() {
  return jsonp({ action: "orders", key: ADMIN_KEY });
}

async function renderAdmin() {
  const list = $("#adminList");
  const count = $("#adminCount");
  if (!list) return;
  count.textContent = "กำลังโหลด…";
  list.innerHTML = "";
  try {
    const data = await loadAdminOrders();
    if (!data || !data.ok) {
      count.textContent = "โหลดไม่สำเร็จ" + (data && data.error ? " (" + data.error + ")" : "");
      return;
    }
    const orders = data.orders || [];
    const totalQty = orders.reduce((s, o) => s + (Number(o.quantity) || 0), 0);
    count.textContent = `${orders.length} ออเดอร์ · รวม ${totalQty} ลูก`;

    if (orders.length === 0) {
      list.innerHTML = `<p class="hi-detail" style="padding:10px 4px;">ยังไม่มีออเดอร์</p>`;
      return;
    }

    orders.forEach((o) => {
      const el = document.createElement("article");
      el.className = "history-item";
      const addr = o.method === "จัดส่ง"
        ? `<p class="hi-detail"><strong>ผู้รับ:</strong> ${esc(o.recvName)} (${esc(o.recvPhone)})</p>
           <p class="hi-detail"><strong>ที่อยู่:</strong> ${esc(o.addrLine)} ต.${esc(o.tambon)} อ.${esc(o.amphoe)} จ.${esc(o.province)} ${esc(o.postcode)}</p>`
        : `<p class="hi-detail">รับที่โรงงาน</p>`;
      const round = o.round ? `<p class="hi-detail"><strong>รอบ:</strong> ${esc(o.round)}</p>` : "";
      const note = o.note ? `<p class="hi-detail"><strong>หมายเหตุ:</strong> ${esc(o.note)}</p>` : "";
      const statusTag = o.status === "แก้ไขแล้ว"
        ? `<span class="hi-sync warn">✎ แก้ไขแล้ว</span>` : "";
      el.innerHTML = `
        <div class="history-item-top">
          <span class="hi-qty">${esc(o.quantity)} ลูก</span>
          <span class="hi-method">${esc(o.method)}</span>
        </div>
        <p class="hi-detail"><strong>ผู้จอง:</strong> ${esc(o.user)} (${esc(o.userPhone)}) ${statusTag}</p>
        <p class="hi-date">${esc(o.id)} · ${o.createdAt ? fmtDate(o.createdAt) : ""}</p>
        ${round}${addr}${note}`;
      list.appendChild(el);
    });
  } catch (err) {
    count.textContent = "โหลดไม่สำเร็จ — ลองรีเฟรช (ตรวจว่า redeploy สคริปต์แล้ว)";
  }
}

/* ============================================================
   EXPORT CSV
   ============================================================ */
function exportCSV() {
  const items = myBookings();
  if (items.length === 0) return;
  const headers = ["รหัส","วันเวลา","ผู้จอง","เบอร์ผู้จอง","จำนวน","รอบตัด/จัดส่ง","วิธีรับ","ผู้รับ","เบอร์ผู้รับ","ที่อยู่","ตำบล","อำเภอ","จังหวัด","รหัสไปรษณีย์","หมายเหตุ"];
  const rows = items.map((b) => [
    b.id, fmtDate(b.createdAt), b.user, b.userPhone, b.quantity, b.round || "", b.method,
    b.recvName || "", b.recvPhone || "", b.addrLine || "", b.tambon || "",
    b.amphoe || "", b.province || "", b.postcode || "", b.note || "",
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  // ﻿ = BOM ให้ Excel อ่านภาษาไทยได้ถูกต้อง
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `จองทุเรียนลุงทิม_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast("ดาวน์โหลดไฟล์ CSV แล้ว");
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer = null;
function toast(msg) {
  $("#toastText").textContent = msg;
  const t = $("#toast");
  t.classList.remove("is-hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("is-hidden"), 3000);
}
