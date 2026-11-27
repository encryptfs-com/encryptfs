export function attachDelayedTooltip(control, tooltip, { delay = 1000, scope = control.ownerDocument,
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  let timer;
  const hide = () => { cancel(timer); timer = undefined; tooltip.hidden = true; };
  const showLater = () => { hide(); timer = schedule(() => { timer = undefined; if (!control.disabled) tooltip.hidden = false; }, delay); };
  const wrapper = control.parentElement;
  wrapper.addEventListener('pointerenter', showLater);
  wrapper.addEventListener('pointerleave', hide);
  control.addEventListener('focus', showLater);
  control.addEventListener('blur', hide);
  control.addEventListener('click', hide);
  scope.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  return { hide };
}
