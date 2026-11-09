export const appUiHelpers = String.raw`<script>
(() => {
  const PROPERTIES = new Set(['value', 'checked', 'disabled', 'hidden', 'required']);

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    const later = [];
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key === 'class') el.className = value;
      else if (PROPERTIES.has(key)) later.push([key, value]);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    for (const [key, value] of later) el[key] = value;
    return el;
  }

  const SVG = 'http://www.w3.org/2000/svg';
  function icon(kind) {
    const svg = document.createElementNS(SVG, 'svg');
    for (const [name, value] of Object.entries({ viewBox: '0 0 20 20', width: 18, height: 18, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'aria-hidden': 'true', class: 'icon' })) {
      svg.setAttribute(name, String(value));
    }
    const body = document.createElementNS(SVG, 'rect');
    for (const [name, value] of Object.entries({ x: 4, y: 9, width: 12, height: 8.5, rx: 1.5 })) body.setAttribute(name, String(value));
    const shackle = document.createElementNS(SVG, 'path');
    shackle.setAttribute('d', kind === 'open' ? 'M7 9V6.5a3 3 0 0 1 5.8-1.2' : 'M7 9V6.5a3 3 0 0 1 6 0V9');
    svg.append(body, shackle);
    return svg;
  }

  function pageHead(title, text) {
    return h('div', { class: 'page-head' }, h('h1', null, title), text ? h('p', null, text) : null);
  }

  function field(id, labelText, control, hint) {
    control.id = id;
    const described = [hint ? id + '-hint' : null, id + '-error'].filter(Boolean).join(' ');
    control.setAttribute('aria-describedby', described);
    const error = h('p', { class: 'field-error', id: id + '-error', hidden: true });
    const wrap = h('div', { class: 'field' },
      h('label', { for: id }, labelText),
      control,
      hint ? h('p', { class: 'hint', id: id + '-hint' }, hint) : null,
      error);
    return { wrap, control, error };
  }

  function select(options, value) {
    return h('select', { value: value || '' }, options.map(([optionValue, label]) => h('option', { value: String(optionValue) }, label)));
  }

  window.MFUAppUI = { h, icon, pageHead, field, select };
})();
</script>`;
