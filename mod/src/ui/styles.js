export const STYLE_ID = "polyranked-styles";

export const CSS = `
.polyranked-menu-button img { filter: none; }
.polyranked-ui, .polyranked-hud, .polyranked-overlay { font-family: ForcedSquare, Arial, sans-serif; color: var(--text-color, #fff); }
.polyranked-ui { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: rgba(10, 14, 36, 0.55); z-index: 50; }
.polyranked-ui.hidden { display: none; }
.polyranked-ui .pr-box { width: 760px; max-width: calc(100% - 40px); max-height: calc(100% - 40px); overflow: auto; background: var(--surface-secondary-color, #212b58); box-shadow: 0 0 40px rgba(0,0,0,0.5); }
.polyranked-ui h2 { margin: 0; padding: 10px 20px; font-weight: normal; font-size: 38px; text-align: center; background: var(--surface-color, #28346a); }
.polyranked-ui h3 { margin: 0 0 8px 0; font-weight: normal; font-size: 24px; opacity: 0.9; }
.polyranked-ui .pr-section { margin: 10px; padding: 14px 18px; background: var(--surface-color, #28346a); }
.polyranked-ui .pr-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.polyranked-ui .pr-status { font-size: 20px; opacity: 0.9; }
.polyranked-ui .pr-status.err { color: #ff9696; }
.polyranked-ui .pr-status.ok { color: #9cf59c; }
.polyranked-ui .pr-profile { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.polyranked-ui .pr-name { font-size: 30px; }
.polyranked-ui .pr-ratings { display: flex; gap: 10px; flex-wrap: wrap; }
.polyranked-ui .pr-rating { padding: 8px 12px; background: var(--surface-secondary-color, #212b58); min-width: 150px; }
.polyranked-ui .pr-rating .pr-q { font-size: 18px; opacity: 0.8; }
.polyranked-ui .pr-rating .pr-div { font-size: 24px; }
.polyranked-ui .pr-rating .pr-num { font-size: 20px; opacity: 0.85; }
.polyranked-ui .pr-queues { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.polyranked-ui .pr-queue { display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 12px; background: var(--surface-secondary-color, #212b58); }
.polyranked-ui .pr-queue .pr-qname { font-size: 26px; }
.polyranked-ui .pr-queue .pr-qinfo { font-size: 18px; opacity: 0.8; }
.polyranked-ui .pr-searching { display: flex; align-items: center; gap: 14px; font-size: 26px; }
.polyranked-ui .pr-spinner { width: 28px; height: 28px; border-radius: 50%; border: 4px solid var(--surface-tertiary-color, #192042); border-left-color: #fff; animation: pr-spin 0.9s linear infinite; }
@keyframes pr-spin { to { transform: rotate(360deg); } }
.polyranked-ui input[type=text] { font-family: inherit; font-size: 22px; padding: 6px 10px; background: var(--surface-tertiary-color, #192042); color: #fff; border: none; width: 100%; box-sizing: border-box; }
.polyranked-ui label { font-size: 18px; opacity: 0.85; display: block; margin-bottom: 4px; }
.polyranked-ui .pr-buttons { display: flex; gap: 10px; justify-content: flex-end; padding: 10px; background: var(--surface-color, #28346a); flex-wrap: wrap; }
.polyranked-ui table { width: 100%; border-collapse: collapse; font-size: 20px; }
.polyranked-ui td, .polyranked-ui th { padding: 4px 8px; text-align: left; }
.polyranked-ui th { font-weight: normal; opacity: 0.7; }
.polyranked-ui tr.self td { color: #ffe08a; }
.polyranked-ui .pr-small { font-size: 16px; opacity: 0.7; }
.polyranked-ui .pr-link { color: #9cc7ff; }

.polyranked-hud { position: absolute; right: 12px; top: 120px; width: 300px; pointer-events: none; z-index: 20; }
.polyranked-hud.hidden { display: none; }
.polyranked-hud .pr-card { background: var(--surface-transparent-color, rgba(40,52,106,0.6)); padding: 8px 12px; margin-bottom: 8px; }
.polyranked-hud .pr-title { font-size: 20px; opacity: 0.8; display: flex; justify-content: space-between; }
.polyranked-hud .pr-score { font-size: 34px; display: flex; justify-content: space-between; align-items: baseline; }
.polyranked-hud .pr-timer { font-size: 30px; text-align: center; }
.polyranked-hud .pr-timer.warn { color: #ff9696; }
.polyranked-hud .pr-list { font-size: 19px; }
.polyranked-hud .pr-list .pr-line { display: flex; justify-content: space-between; gap: 8px; }
.polyranked-hud .pr-list .pr-line.self { color: #ffe08a; }
.polyranked-hud .pr-list .pr-line.t0 .pr-team { color: #7fb8ff; }
.polyranked-hud .pr-list .pr-line.t1 .pr-team { color: #ff9c7a; }
.polyranked-hud .pr-toast { font-size: 22px; text-align: center; padding: 6px; background: rgba(0,0,0,0.35); }

.polyranked-overlay { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: rgba(10, 14, 36, 0.75); z-index: 60; }
.polyranked-overlay.hidden { display: none; }
.polyranked-overlay .pr-box { width: 700px; max-width: calc(100% - 40px); background: var(--surface-secondary-color, #212b58); }
.polyranked-overlay h2 { margin: 0; padding: 10px 20px; font-weight: normal; font-size: 40px; text-align: center; background: var(--surface-color, #28346a); }
.polyranked-overlay .pr-result { font-size: 46px; text-align: center; padding: 14px; }
.polyranked-overlay .pr-result.win { color: #9cf59c; }
.polyranked-overlay .pr-result.loss { color: #ff9696; }
.polyranked-overlay .pr-section { margin: 10px; padding: 12px 18px; background: var(--surface-color, #28346a); }
.polyranked-overlay table { width: 100%; border-collapse: collapse; font-size: 22px; }
.polyranked-overlay td { padding: 4px 8px; }
.polyranked-overlay tr.self td { color: #ffe08a; }
.polyranked-overlay .pr-delta.up { color: #9cf59c; }
.polyranked-overlay .pr-delta.down { color: #ff9696; }
.polyranked-overlay .pr-buttons { display: flex; gap: 10px; justify-content: flex-end; padding: 10px; background: var(--surface-color, #28346a); }
.polyranked-overlay .pr-lobby-status { font-size: 26px; text-align: center; padding: 10px 14px; }
.polyranked-overlay .pr-lobby-countdown { font-size: 34px; text-align: center; padding: 0 0 10px 0; color: #ffe08a; }
.polyranked-overlay .pr-winner { font-size: 40px; text-align: center; padding: 10px; color: #ffe08a; }
.polyranked-overlay td.pr-place { width: 40px; opacity: 0.8; }
.polyranked-overlay td.pr-right { text-align: right; }

.polyranked-cup { position: absolute; left: 0; bottom: calc(100% + 16px); width: 700px; box-sizing: border-box; background: var(--surface-secondary-color, #212b58); font-family: ForcedSquare, Arial, sans-serif; color: var(--text-color, #fff); }
.polyranked-cup .pr-cup-body { padding: 12px 16px 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.polyranked-cup .pr-cup-title { display: flex; align-items: center; gap: 10px; font-size: 30px; }
.polyranked-cup .pr-cup-title img { width: 34px; height: 34px; }
.polyranked-cup .pr-cup-status { font-size: 19px; opacity: 0.85; min-height: 1.3em; }
.polyranked-cup .pr-cup-status.err { color: #ff9696; opacity: 1; }
.polyranked-cup .pr-cup-join { width: 100%; box-sizing: border-box; margin: 0; padding: 14px 20px; font-size: 38px; text-align: center; justify-content: center; }
.polyranked-cup .pr-cup-join .button-icon { margin-right: 10px; }
`;

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
