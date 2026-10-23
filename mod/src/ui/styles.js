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

/* ---- the cup's in-game overlay (PolyCup-style) ---- */
.prc-hud, .prc-pov, .prc-pb, .prc-round-timer, .prc-start-cue, .prc-downtime, .prc-practice, .prc-notice { font-family: ForcedSquare, Arial, sans-serif; font-style: italic; color: #fff; --prc-deep: #192042; --prc-blue: #212b58; --prc-muted: #b3c7df; --prc-gold: #ffd26b; --prc-cut: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%); }
.prc-hud { position: absolute; left: 0; top: 0; width: min(420px, calc(100vw - 8px)); max-height: calc(100% - 70px); overflow: hidden; pointer-events: none; z-index: 22; display: flex; flex-direction: column; gap: 3px; transition: top .18s ease-out; }
.prc-hud.hidden, .prc-pov.hidden, .prc-pb.hidden, .prc-start-cue.hidden, .prc-downtime.hidden, .prc-practice.hidden, .prc-notice.hidden { display: none; }
.prc-summary { display: flex; flex-direction: column; gap: 3px; }
.prc-track { background: var(--prc-deep); padding: 9px 18px; clip-path: polygon(0 0, 100% 0, calc(100% - 16px) 100%, 0 100%); }
.prc-track > strong { display: block; font-size: 30px; font-weight: normal; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 6px; }
.prc-meta { display: flex; justify-content: space-between; gap: 10px; margin-top: 5px; font-size: 18px; text-transform: uppercase; }
.prc-meta > span { color: var(--prc-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prc-meta > strong { font-weight: normal; white-space: nowrap; }
.prc-phase { margin-top: 5px; font-size: 18px; color: var(--prc-gold); }
.prc-record { display: grid; grid-template-columns: 30px minmax(0, 1fr) 100px; gap: 7px; align-items: center; padding: 6px 18px; font-size: 18px; background: var(--prc-blue); clip-path: var(--prc-cut); }
.prc-record > strong:first-child { font-weight: normal; color: #ff9150; }
.prc-record.prc-tr > strong:first-child { color: var(--prc-gold); }
.prc-record .prc-holder { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding-right: 4px; }
.prc-record .prc-rtime { text-align: right; font-size: 24px; font-weight: normal; }
.prc-board { margin-top: 23px; display: flex; flex-direction: column; gap: 4px; }
.prc-heading { display: flex; justify-content: center; padding: 10px 18px; background: #112052; clip-path: var(--prc-cut); }
.prc-heading > strong { font-size: 26px; font-weight: bold; }
.prc-winner { padding: 10px 18px; border-top: 2px solid var(--prc-gold); background: #273c3b; clip-path: var(--prc-cut); font-size: 26px; }
.prc-winner > small { display: block; color: var(--prc-gold); font-size: 18px; margin-bottom: 4px; }
.prc-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) 76px 110px; align-items: center; gap: 4px; min-height: 34px; padding: 1px 0 1px 18px; font-size: 18px; background: var(--prc-blue); clip-path: var(--prc-cut); }
.prc-board.has-movement .prc-row { grid-template-columns: 20px minmax(0, 1fr) 24px 76px 110px; }
.prc-board:not(.has-movement) .prc-move { display: none; }
.prc-row.self { background: #ed7833; color: #111e34; }
.prc-row.pending { opacity: .7; }
.prc-row.winner { background: #273c3b; }
.prc-pos { font-size: 20px; font-weight: normal; color: #aec2d9; }
.prc-row.self .prc-pos { color: #111e34; }
.prc-name { display: flex; align-items: center; gap: 6px; min-width: 0; }
.prc-name > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 4px; }
.prc-row.self .prc-name > span { text-decoration: underline; text-underline-offset: 3px; }
.prc-car { width: 32px; height: 28px; flex: 0 0 32px; object-fit: contain; }
.prc-move { font-size: 18px; text-align: right; }
.prc-move.up { color: #76e8ba; } .prc-move.down { color: #ff9d9d; }
.prc-row.self .prc-move.up { color: #0b4d35; } .prc-row.self .prc-move.down { color: #7a1d1d; }
.prc-points { display: flex; justify-content: flex-end; align-items: center; gap: 5px; padding-right: 5px; }
.prc-points > strong { font-size: 24px; font-weight: normal; }
.prc-points > small { font-size: 18px; color: #76e8ba; }
.prc-points > small.projected { color: var(--prc-gold); }
.prc-row.self .prc-points > small { color: #0b4d35; }
.prc-time { align-self: stretch; display: flex; justify-content: center; align-items: center; margin: 2px 10px 2px 0; padding: 0 10px; background: #e9f1f8; color: #152238; font-size: 20px; white-space: nowrap; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); }
.prc-round-timer { position: absolute; right: 0; bottom: 110px; min-width: 106px; padding: 9px 20px 9px 28px; box-sizing: border-box; background: var(--prc-deep); clip-path: polygon(14px 0, 100% 0, 100% 100%, 0 100%); color: #ff747c; font-size: 36px; line-height: 1; text-align: center; font-variant-numeric: tabular-nums; pointer-events: none; transform: translateX(100%); opacity: 0; transition: transform .22s ease-out, opacity .15s ease-out; z-index: 22; }
.prc-round-timer.visible { transform: translateX(0); opacity: 1; }
.prc-start-cue { position: absolute; left: 50%; top: 32%; transform: translate(-50%, -50%); font-size: 120px; line-height: 1; color: #fff; text-shadow: 0 4px 10px rgba(0,0,0,.5); pointer-events: none; z-index: 23; animation: prc-pop .5s ease-out; }
.prc-start-cue.go { color: #9cf59c; }
@keyframes prc-pop { from { transform: translate(-50%, -50%) scale(1.3); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
.prc-downtime { position: absolute; left: 50%; top: 27%; transform: translateX(-50%); font-size: clamp(24px, 2.5vw, 36px); line-height: 1.2; text-align: center; text-shadow: 0 2px 3px #101a3c, 0 0 12px #101a3c; pointer-events: none; z-index: 22; white-space: nowrap; }
.prc-practice { position: absolute; right: 18px; bottom: 164px; z-index: 22; }
.prc-practice-box { display: flex; align-items: center; gap: 12px; padding: 6px 8px 6px 18px; background: var(--prc-deep); clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); font-size: 22px; }
.prc-practice-box > span { color: var(--prc-muted); }
.prc-practice-box > strong { min-width: 42px; text-align: right; font-weight: normal; }
.prc-practice-box .button.prc-ready { min-width: 112px; margin: 0; padding: 8px 18px; font-size: 22px; }
.prc-pov { position: absolute; left: 50%; bottom: 118px; transform: translateX(-50%); width: min(420px, calc(100vw - 24px)); z-index: 22; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.prc-pov-box { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; gap: 6px; width: 100%; }
.prc-pov .button.prc-pov-cycle { margin: 0; padding: 0; height: 44px; display: flex; align-items: center; justify-content: center; }
.prc-arrow { width: 10px; height: 10px; border-top: 3px solid currentColor; border-right: 3px solid currentColor; transform: rotate(45deg); }
.prc-arrow.left { transform: rotate(-135deg); }
.prc-pov-main { min-width: 0; height: 44px; padding: 6px 12px; box-sizing: border-box; background: #112052; clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 100%, 0 100%); }
.prc-pov-name { display: flex; align-items: center; justify-content: center; height: 32px; padding: 0 12px; background: #e9f1f8; color: #152238; font-size: 26px; line-height: 32px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; clip-path: polygon(6px 0, calc(100% - 6px) 0, 100% 100%, 0 100%); }
.prc-pov-hint { font-size: 16px; color: var(--prc-muted); text-shadow: 0 1px 2px #101a3c; }
.prc-pb { position: absolute; right: 8px; bottom: 118px; display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: center; gap: 6px; width: 196px; height: 34px; padding-left: 14px; box-sizing: border-box; background: var(--prc-blue); clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); font-size: 20px; white-space: nowrap; z-index: 22; }
.prc-pb > span { color: #78e1b6; }
.prc-pb > strong { display: flex; align-items: center; justify-content: center; align-self: stretch; margin: 3px 8px 3px 0; padding: 0 8px; background: #e9f1f8; color: #152238; font-size: 22px; font-weight: normal; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); }
.prc-notice { position: absolute; left: 50%; bottom: 196px; transform: translateX(-50%); padding: 10px 20px; background: #112052; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); font-size: 22px; pointer-events: none; max-width: calc(100vw - 32px); text-align: center; z-index: 23; }
@media (max-height: 700px) { .prc-row { min-height: 28px; } .prc-car { height: 23px; } .prc-track > strong { font-size: 26px; } }
`;

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
