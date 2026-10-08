// @ts-check
// ── date-picker-utils.js ── Logique du sélecteur de date/heure

const _MONTHS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];
const _DAYS_FR = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];

function _dtFormat(d, isDateTime) {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  if (!isDateTime) return `${dd}/${mm}/${yyyy}`;
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} à ${hh}:${min}`;
}

function _dtToNative(d, isDateTime) {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  if (!isDateTime) return `${yyyy}-${mm}-${dd}`;
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function _dtFromNative(val, isDateTime) {
  if (!val) return null;
  const d = new Date(isDateTime ? val : val + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function _buildDtCalendar(popup, state) {
  const { year, month, selected, isDateTime } = state;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const today = new Date();
  const todayMs = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const selMs = selected
    ? new Date(
        selected.getFullYear(),
        selected.getMonth(),
        selected.getDate(),
      ).getTime()
    : null;

  const days = [];
  for (let i = startDow - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month, -i), other: true });
  }
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push({ date: new Date(year, month, i), other: false });
  }
  let n = 1;
  while (days.length < 42) {
    days.push({ date: new Date(year, month + 1, n++), other: true });
  }

  const daysHTML = days
    .map(({ date, other }) => {
      const ms = date.getTime();
      const isSel = ms === selMs;
      const isToday = ms === todayMs;
      let cls = "dt-day";
      if (other) cls += " other-month";
      if (isSel) cls += " selected";
      if (isToday && !isSel) cls += " today";
      return `<button class="${cls}" type="button" data-ms="${ms}"${other ? " tabindex='-1'" : ""}>${date.getDate()}</button>`;
    })
    .join("");

  const selH = selected ? String(selected.getHours()).padStart(2, "0") : "09";
  const selM = selected ? String(selected.getMinutes()).padStart(2, "0") : "00";

  popup.innerHTML = `
    <div class="dt-cal">
      <div class="dt-cal-nav">
        <button class="dt-nav-btn dt-prev" type="button" aria-label="Mois précédent">&#8249;</button>
        <span class="dt-month-label">${_MONTHS_FR[month]} ${year}</span>
        <button class="dt-nav-btn dt-next" type="button" aria-label="Mois suivant">&#8250;</button>
      </div>
      <div class="dt-weekdays">${_DAYS_FR.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="dt-days">${daysHTML}</div>
    </div>
    ${
      isDateTime
        ? `
    <div class="dt-time-sep"></div>
    <div class="dt-time-section">
      <div class="dt-time-label">Heure</div>
      <div class="dt-time-row">
        <input type="number" class="dt-hour" min="0" max="23" value="${selH}">
        <span class="dt-time-colon">:</span>
        <input type="number" class="dt-min" min="0" max="59" step="15" value="${selM}">
      </div>
    </div>`
        : ""
    }
    <div class="dt-footer">
      <button class="dt-btn-clear btn btn-ghost btn-sm" type="button">Effacer</button>
      <button class="dt-btn-today btn btn-ghost btn-sm" type="button">Aujourd'hui</button>
      <button class="dt-btn-ok btn btn-primary btn-sm" type="button">OK</button>
    </div>`;
}
