import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDelayedTooltip } from '../dist/lib/delayed-tooltip.js';

function fixture() {
  let elapsed = 0; let sequence = 0; const jobs = new Map();
  const scope = new EventTarget(); const wrapper = new EventTarget(); const control = new EventTarget();
  control.ownerDocument = scope; control.parentElement = wrapper; control.disabled = false;
  const tooltip = { hidden: true };
  const handle = attachDelayedTooltip(control, tooltip, { schedule(callback, delay) { const id = ++sequence; jobs.set(id, { at: elapsed + delay, callback }); return id; }, cancel(id) { jobs.delete(id); } });
  const tick = duration => { elapsed += duration; for (const [id, job] of jobs) if (job.at <= elapsed) { jobs.delete(id); job.callback(); } };
  return { scope, wrapper, control, tooltip, handle, tick };
}
test('Clear workspace tooltip waits exactly one second and hides when pointer leaves', () => {
  const f = fixture(); f.wrapper.dispatchEvent(new Event('pointerenter')); f.tick(999); assert.equal(f.tooltip.hidden, true);
  f.tick(1); assert.equal(f.tooltip.hidden, false); f.wrapper.dispatchEvent(new Event('pointerleave')); assert.equal(f.tooltip.hidden, true);
});
test('keyboard focus supports the delayed tooltip; Escape, blur, and clicks dismiss it', () => {
  const f = fixture(); f.control.dispatchEvent(new Event('focus')); f.tick(1000); assert.equal(f.tooltip.hidden, false);
  const escape = new Event('keydown'); escape.key = 'Escape'; f.scope.dispatchEvent(escape); assert.equal(f.tooltip.hidden, true);
  for (const event of ['blur', 'click']) { f.control.dispatchEvent(new Event('focus')); f.tick(1000); f.control.dispatchEvent(new Event(event)); assert.equal(f.tooltip.hidden, true); }
});
test('early pointer exit, disabled controls, and workspace cleanup prevent stale tooltips', () => {
  const f = fixture(); f.wrapper.dispatchEvent(new Event('pointerenter')); f.tick(400); f.wrapper.dispatchEvent(new Event('pointerleave')); f.tick(1000); assert.equal(f.tooltip.hidden, true);
  f.control.disabled = true; f.control.dispatchEvent(new Event('focus')); f.tick(1000); assert.equal(f.tooltip.hidden, true);
  f.control.disabled = false; f.control.dispatchEvent(new Event('focus')); f.handle.hide(); f.tick(1000); assert.equal(f.tooltip.hidden, true);
});
